import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import Razorpay from "razorpay";

type LineInput = { id: string; quantity: number };
type CustomerInput = { userId?: string; name?: string; email?: string; phone?: string };

export async function POST(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "write");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { items, customer, paymentMethod = "razorpay" } = await request.json() as { items: LineInput[]; customer?: CustomerInput; paymentMethod?: "razorpay" | "cod" };
    if (!Array.isArray(items) || !items.length) return Response.json({ error: "Your cart is empty" }, { status: 400 });
    if (!customer?.userId) return Response.json({ error: "Please sign in before placing an order" }, { status: 401 });
    if (paymentMethod !== "razorpay" && paymentMethod !== "cod") return Response.json({ error: "Unsupported payment method" }, { status: 400 });
    const db = await getDb();
    await ensureCollections(db);
    if (items.some((item) => !ObjectId.isValid(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1)) return Response.json({ error: "Your cart contains an invalid item" }, { status: 400 });
    const ids = items.map((item) => new ObjectId(item.id));
    const products = await db.collection("inventory").find({ _id: { $in: ids }, active: true }).toArray();
    const lines = items.map((line) => {
      const product = products.find((entry) => entry._id.toString() === line.id);
      if (!product || line.quantity < 1 || line.quantity > product.stock) {
        throw new Error(`Item ${product?.name || line.id} is unavailable in the requested quantity`);
      }
      return { inventoryId: product._id, productId: product._id, sku: product.sku, name: product.name, price: product.price, quantity: line.quantity, lineTotal: product.price * line.quantity, productSnapshot: { name: product.name, sku: product.sku, unit: product.unit, imageUrl: product.imageUrl || null } };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0), delivery = 20, total = subtotal + delivery;
    const amount = Math.round(total * 100);
    if (amount < 100) return Response.json({ error: "The minimum payment amount is ₹1" }, { status: 400 });
    const now = new Date();
    const order = { orderNumber: `NC-${Date.now().toString().slice(-8)}`, userId: customer.userId, customer: { userId: customer.userId, name: customer.name || "", email: customer.email || "", phone: customer.phone || "" }, lines, summary: { itemCount: lines.length, unitCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal, delivery, total }, subtotal, delivery, total, currency: "INR", paymentStatus: paymentMethod === "cod" ? "pending_cod" : "created", orderStatus: paymentMethod === "cod" ? "placed" : "awaiting_payment", paymentMethod, expiresAt: paymentMethod === "razorpay" ? new Date(now.getTime() + 10 * 60 * 1000) : null, inventoryFinalized: paymentMethod === "cod", createdAt: now, updatedAt: now };
    const inserted = await db.collection("orders").insertOne(order);
    if (paymentMethod === "cod") {
      const updates = await Promise.all(lines.map((line) => db.collection("inventory").updateOne({ _id: line.inventoryId, stock: { $gte: line.quantity } }, { $inc: { stock: -line.quantity }, $set: { updatedAt: now } })));
      if (updates.some((result) => result.modifiedCount !== 1)) return Response.json({ error: "One or more items are no longer available" }, { status: 409 });
      const paymentReferenceId = `COD-${order.orderNumber}`;
      await db.collection("payments").insertOne({ orderId: inserted.insertedId, userId: order.userId, orderNumber: order.orderNumber, amount: total, currency: "INR", paymentMethod: "cod", paymentStatus: "pending_cod", paymentReferenceId, createdAt: now, updatedAt: now });
      return Response.json({ orderId: inserted.insertedId.toString(), orderNumber: order.orderNumber, paymentMethod: "cod", orderStatus: "placed" });
    }
    const keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return Response.json({ error: "Razorpay Test Mode is not configured" }, { status: 503 });
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const paymentOrder = await razorpay.orders.create({ amount, currency: "INR", receipt: order.orderNumber, notes: { mongo_order_id: inserted.insertedId.toString() } });
    await db.collection("orders").updateOne({ _id: inserted.insertedId }, { $set: { razorpayOrderId: paymentOrder.id, updatedAt: new Date() } });
    return Response.json({ mongoOrderId: inserted.insertedId.toString(), razorpayOrderId: paymentOrder.id, keyId, amount, currency: "INR", orderNumber: order.orderNumber });
  } catch (error) {
    console.error(error);
    const statusCode = error && typeof error === "object" && "statusCode" in error && (error as { statusCode?: number }).statusCode === 401 ? 401 : 500;
    return Response.json({ error: statusCode === 401 ? "Razorpay credentials were rejected" : error instanceof Error ? error.message : "Unable to create order" }, { status: statusCode });
  }
}

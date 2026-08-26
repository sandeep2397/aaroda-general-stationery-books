import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ensureCollections } from "@/lib/mongo-schema";

type LineInput = { id: string; quantity: number };

export async function POST(request: Request) {
  try {
    const { items, customer } = await request.json() as { items: LineInput[]; customer?: { name?: string; phone?: string } };
    if (!Array.isArray(items) || !items.length) return Response.json({ error: "Your cart is empty" }, { status: 400 });
    const db = await getDb();
    await ensureCollections(db);
    const ids = items.map((item) => new ObjectId(item.id));
    const products = await db.collection("inventory").find({ _id: { $in: ids }, active: true }).toArray();
    const lines = items.map((line) => {
      const product = products.find((entry) => entry._id.toString() === line.id);
      if (!product || line.quantity < 1 || line.quantity > product.stock) throw new Error("An item is unavailable in the requested quantity");
      return { inventoryId: product._id, sku: product.sku, name: product.name, price: product.price, quantity: line.quantity, lineTotal: product.price * line.quantity };
    });
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0), delivery = 20, total = subtotal + delivery;
    const order = { orderNumber: `NC-${Date.now().toString().slice(-8)}`, customer: customer || {}, lines, subtotal, delivery, total, currency: "INR", paymentStatus: "created", orderStatus: "awaiting_payment", createdAt: new Date(), updatedAt: new Date() };
    const inserted = await db.collection("orders").insertOne(order);
    const keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return Response.json({ error: "Razorpay Test Mode is not configured", orderId: inserted.insertedId.toString() }, { status: 503 });
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", { method:"POST", headers:{ Authorization:`Basic ${auth}`, "Content-Type":"application/json" }, body:JSON.stringify({ amount:total * 100, currency:"INR", receipt:order.orderNumber, notes:{ mongo_order_id:inserted.insertedId.toString() } }) });
    if (!response.ok) throw new Error(`Razorpay order failed: ${await response.text()}`);
    const paymentOrder = await response.json() as { id: string };
    await db.collection("orders").updateOne({ _id: inserted.insertedId }, { $set: { razorpayOrderId: paymentOrder.id, updatedAt: new Date() } });
    return Response.json({ mongoOrderId: inserted.insertedId.toString(), razorpayOrderId: paymentOrder.id, keyId, amount: total * 100, currency: "INR", orderNumber: order.orderNumber });
  } catch (error) {
    console.error(error); return Response.json({ error: error instanceof Error ? error.message : "Unable to create order" }, { status: 500 });
  }
}

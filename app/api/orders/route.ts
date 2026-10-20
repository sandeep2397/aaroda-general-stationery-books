import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import { getFirebaseUser } from "@/lib/firebase-server";
import Razorpay from "razorpay";

type LineInput = { id: string; quantity: number };
type AddressInput = { id?: string; label?: string; recipientName?: string; phone?: string; line1?: string; line2?: string; landmark?: string; city?: string; state?: string; postalCode?: string; location?: { lat?: string; lon?: string } };
const DELIVERY_THRESHOLD = 199, DELIVERY_FEE = 20;
const deliveryFor = (subtotal: number) => subtotal >= DELIVERY_THRESHOLD ? 0 : DELIVERY_FEE;
const existingResult = (order: Record<string, unknown>) => ({ mongoOrderId: String(order._id), orderNumber: order.orderNumber, paymentMethod: order.paymentMethod, orderStatus: order.orderStatus, razorpayOrderId: order.razorpayOrderId, amount: Math.round(Number(order.total || 0) * 100), currency: "INR", keyId: process.env.RAZORPAY_KEY_ID, idempotent: true });

export async function POST(request: Request) {
  const limited = applyRateLimit(request, "write"); if (limited) return limited;
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in before placing an order." }, { status: 401 });
  try {
    const { items, paymentMethod = "razorpay", address } = await request.json() as { items: LineInput[]; paymentMethod?: "razorpay" | "cod"; address?: AddressInput };
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 128) return Response.json({ error: "A valid idempotency key is required to place an order." }, { status: 400 });
    if (!Array.isArray(items) || !items.length) return Response.json({ error: "Your cart is empty." }, { status: 400 });
    if (paymentMethod !== "razorpay" && paymentMethod !== "cod") return Response.json({ error: "Unsupported payment method." }, { status: 400 });
    const requiredAddress = ["recipientName", "phone", "line1", "city", "state", "postalCode"] as const;
    if (!address || requiredAddress.some((key) => !String(address[key] || "").trim())) return Response.json({ error: "Choose or add a complete delivery address." }, { status: 400 });
    if (!/^[0-9]{10}$/.test(String(address.phone).replace(/\D/g, "")) || !/^\d{6}$/.test(String(address.postalCode))) return Response.json({ error: "Your delivery phone number or PIN code is invalid." }, { status: 400 });
    if (items.some((item) => !ObjectId.isValid(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1)) return Response.json({ error: "Your cart contains an invalid item." }, { status: 400 });

    const db = await getDb(); await ensureCollections(db); const orders = db.collection("orders"), inventory = db.collection("inventory");
    const replay = await orders.findOne({ userId: user.userId, idempotencyKey });
    if (replay) return Response.json(existingResult(replay));
    const ids = items.map((line) => new ObjectId(line.id)); const products = await inventory.find({ _id: { $in: ids }, active: true }).toArray();
    const lines = items.map((line) => {
      const product = products.find((entry) => entry._id.toString() === line.id);
      if (!product || line.quantity > Number(product.stock || 0)) throw new Error(`${product?.name || "An item"} is no longer available in the requested quantity.`);
      const images = Array.isArray(product.imageUrl) ? product.imageUrl : product.imageUrl ? [product.imageUrl] : [];
      return { inventoryId: product._id, productId: product._id, sku: product.sku, name: product.name, categoryType: product.categoryType, price: Number(product.price), quantity: line.quantity, lineTotal: Number(product.price) * line.quantity, inventoryVersion: Number(product.version || 1), productSnapshot: { name: product.name, sku: product.sku, unit: product.unit, imageUrl: images[0] || null } };
    });
    const reserved: typeof lines = [];
    try {
      for (const line of lines) {
        const result = await inventory.updateOne({ _id: line.inventoryId, active: true, stock: { $gte: line.quantity }, version: line.inventoryVersion }, { $inc: { stock: -line.quantity, reservedStock: line.quantity, version: 1 }, $set: { updatedAt: new Date() } });
        if (result.modifiedCount !== 1) throw new Error(`${line.name} changed while you were checking out. Please refresh your basket.`);
        reserved.push(line);
      }
    } catch (error) {
      await Promise.all(reserved.map((line) => inventory.updateOne({ _id: line.inventoryId }, { $inc: { stock: line.quantity, reservedStock: -line.quantity, version: 1 }, $set: { updatedAt: new Date() } })));
      return Response.json({ error: error instanceof Error ? error.message : "We could not reserve your items." }, { status: 409 });
    }
    const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0), delivery = deliveryFor(subtotal), total = subtotal + delivery, now = new Date();
    const order = { orderNumber: `AR-${Date.now().toString().slice(-8)}`, userId: user.userId, customer: { userId: user.userId, name: "", email: user.email || "" }, deliveryAddress: { ...address, phone: String(address.phone).replace(/\D/g, "") }, lines, summary: { itemCount: lines.length, unitCount: lines.reduce((sum, line) => sum + line.quantity, 0), subtotal, delivery, total, freeDelivery: delivery === 0 }, subtotal, delivery, total, currency: "INR", paymentStatus: paymentMethod === "cod" ? "cash_on_delivery" : "created", orderStatus: paymentMethod === "cod" ? "placed" : "awaiting_payment", paymentMethod, idempotencyKey, expiresAt: paymentMethod === "razorpay" ? new Date(now.getTime() + 600000) : null, inventoryFinalized: paymentMethod === "cod", stockReserved: true, createdAt: now, updatedAt: now };
    let inserted;
    try { inserted = await orders.insertOne(order); } catch (error) {
      await Promise.all(reserved.map((line) => inventory.updateOne({ _id: line.inventoryId }, { $inc: { stock: line.quantity, reservedStock: -line.quantity, version: 1 }, $set: { updatedAt: new Date() } })));
      const duplicate = await orders.findOne({ userId: user.userId, idempotencyKey }); if (duplicate) return Response.json(existingResult(duplicate)); throw error;
    }
    if (paymentMethod === "cod") {
      await db.collection("payments").insertOne({ orderId: inserted.insertedId, userId: user.userId, orderNumber: order.orderNumber, amount: total, currency: "INR", paymentMethod: "cod", paymentStatus: "cash_on_delivery", paymentReferenceId: `COD-${order.orderNumber}`, createdAt: now, updatedAt: now });
      return Response.json({ mongoOrderId: inserted.insertedId.toString(), orderNumber: order.orderNumber, paymentMethod: "cod", orderStatus: "placed", subtotal, delivery, total });
    }
    const keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) throw new Error("Razorpay Test Mode is not configured.");
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret }); const paymentOrder = await razorpay.orders.create({ amount: Math.round(total * 100), currency: "INR", receipt: order.orderNumber, notes: { mongo_order_id: inserted.insertedId.toString() } });
    await orders.updateOne({ _id: inserted.insertedId }, { $set: { razorpayOrderId: paymentOrder.id, updatedAt: new Date() } });
    return Response.json({ mongoOrderId: inserted.insertedId.toString(), razorpayOrderId: paymentOrder.id, keyId, amount: Math.round(total * 100), currency: "INR", orderNumber: order.orderNumber, subtotal, delivery, total });
  } catch (error) {
    console.error("POST /api/orders error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create order." }, { status: 500 });
  }
}

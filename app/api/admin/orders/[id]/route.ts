import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getFirebaseUser } from "@/lib/firebase-server";
import { isAdminEmail } from "@/lib/admin";

type OrderLine = { inventoryId?: ObjectId; productId?: ObjectId; quantity?: number; name?: string; sku?: string };

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in to manage orders." }, { status: 401 });
  if (!isAdminEmail(user.email)) return Response.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await context.params;
  if (!ObjectId.isValid(id)) return Response.json({ error: "Invalid order id." }, { status: 400 });
  const body = await request.json().catch(() => ({})) as { action?: "accept" | "decline"; reason?: string };
  if (body.action !== "accept" && body.action !== "decline") return Response.json({ error: "Choose accept or decline." }, { status: 400 });

  try {
    const db = await getDb();
    const orders = db.collection("orders");
    const orderId = new ObjectId(id);
    const order = await orders.findOne({ _id: orderId });
    if (!order) return Response.json({ error: "Order not found." }, { status: 404 });
    if (["expired", "cancelled", "declined", "accepted"].includes(String(order.orderStatus))) return Response.json({ error: `This order is already ${order.orderStatus}.` }, { status: 409 });
    if (order.paymentStatus !== "paid" && order.paymentMethod !== "cod") return Response.json({ error: "Only paid or COD orders can be accepted." }, { status: 409 });

    const now = new Date();
    if (body.action === "accept") {
      const lines = (order.lines || []) as OrderLine[];
      if (order.stockReserved) {
        await Promise.all(lines.map((line) => db.collection("inventory").updateOne({ _id: line.inventoryId || line.productId }, { $inc: { reservedStock: -Number(line.quantity || 0) }, $set: { updatedAt: now } })));
      }
      if (!order.inventoryFinalized) {
        for (const line of lines) {
          const inventoryId = line.inventoryId || line.productId;
          const quantity = Number(line.quantity || 0);
          if (!inventoryId || quantity < 1) continue;
          const result = await db.collection("inventory").updateOne({ _id: inventoryId, active: true, stock: { $gte: quantity } }, { $inc: { stock: -quantity }, $set: { updatedAt: now } });
          if (result.modifiedCount !== 1) return Response.json({ error: `Insufficient stock for ${line.name || line.sku || "an item"}.` }, { status: 409 });
        }
      }
      await orders.updateOne({ _id: orderId }, { $set: { orderStatus: "accepted", fulfillmentStatus: "accepted", inventoryFinalized: true, stockReserved: false, acceptedAt: now, updatedAt: now } });
    } else {
      if (order.stockReserved) await Promise.all(((order.lines || []) as OrderLine[]).map((line) => db.collection("inventory").updateOne({ _id: line.inventoryId || line.productId }, { $inc: { stock: Number(line.quantity || 0), reservedStock: -Number(line.quantity || 0), version: 1 }, $set: { updatedAt: now } })));
      await orders.updateOne({ _id: orderId }, { $set: { orderStatus: "declined", fulfillmentStatus: "declined", stockReserved: false, declineReason: body.reason?.trim() || "Declined by administrator", declinedAt: now, updatedAt: now } });
    }
    const updated = await orders.findOne({ _id: orderId });
    return Response.json({ success: true, order: updated ? { id: updated._id.toString(), ...updated } : null });
  } catch (error) {
    console.error("PATCH /api/admin/orders/[id] error:", error);
    return Response.json({ error: "Unable to update order." }, { status: 500 });
  }
}

import type { Db, ObjectId } from "mongodb";

const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

export async function expireAwaitingOrders(db: Db, now = new Date()) {
  const expiresBefore = new Date(now.getTime() - PAYMENT_WINDOW_MS);
  const pending = await db.collection("orders").find({ orderStatus: "awaiting_payment", $or: [{ expiresAt: { $lte: now } }, { createdAt: { $lte: expiresBefore } }] }).toArray();
  for (const order of pending) {
    const changed = await db.collection("orders").updateOne({ _id: order._id, orderStatus: "awaiting_payment" }, { $set: { orderStatus: "expired", paymentStatus: "expired", expiredAt: now, updatedAt: now } });
    if (changed.modifiedCount && order.stockReserved) await Promise.all((order.lines || []).map((line: { inventoryId: ObjectId; quantity: number }) => db.collection("inventory").updateOne({ _id: line.inventoryId }, { $inc: { stock: line.quantity, reservedStock: -line.quantity, version: 1 }, $set: { updatedAt: now } })));
  }
  return { expiredCount: pending.length, expiresBefore };
}

export async function purgeExpiredOrders(db: Db) {
  const result = await db.collection("orders").deleteMany({ orderStatus: "expired" });
  return { deletedCount: result.deletedCount };
}

import type { Db } from "mongodb";

const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

export async function expireAwaitingOrders(db: Db, now = new Date()) {
  const expiresBefore = new Date(now.getTime() - PAYMENT_WINDOW_MS);
  const result = await db.collection("orders").updateMany(
    { orderStatus: "awaiting_payment", createdAt: { $lte: expiresBefore } },
    { $set: { orderStatus: "expired", paymentStatus: "expired", expiredAt: now, updatedAt: now } },
  );
  return { expiredCount: result.modifiedCount, expiresBefore };
}

export async function purgeExpiredOrders(db: Db) {
  const result = await db.collection("orders").deleteMany({ orderStatus: "expired" });
  return { deletedCount: result.deletedCount };
}

import { Db, ObjectId } from "mongodb";

export async function finalizePaidOrder(db: Db, razorpayOrderId: string, paymentId: string) {
  const order = await db.collection("orders").findOneAndUpdate(
    { razorpayOrderId, inventoryFinalized: { $ne: true } },
    { $set: { paymentStatus: "paid", orderStatus: "placed", razorpayPaymentId: paymentId, inventoryFinalized: true, paidAt: new Date(), updatedAt: new Date() } },
    { returnDocument: "before" }
  );
  if (!order) return { finalized: false };
  await db.collection("payments").updateOne(
    { orderId: order._id },
    { $setOnInsert: {
      orderId: order._id,
      userId: order.userId,
      orderNumber: order.orderNumber,
      amount: order.total,
      currency: order.currency || "INR",
      paymentMethod: "razorpay",
      paymentStatus: "paid",
      paymentReferenceId: paymentId,
      razorpayOrderId,
      razorpayPaymentId: paymentId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } },
    { upsert: true }
  );
  await Promise.all((order.lines || []).map((line: { inventoryId: ObjectId; quantity: number }) => db.collection("inventory").updateOne({ _id: line.inventoryId, stock: { $gte: line.quantity } }, { $inc: { stock: -line.quantity }, $set: { updatedAt: new Date() } })));
  return { finalized: true, order };
}

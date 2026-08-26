import { createHmac, timingSafeEqual } from "crypto";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";

export async function POST(request: Request) {
  const { mongoOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json();
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return Response.json({ error: "Payment verification is not configured" }, { status: 503 });
  const expected = createHmac("sha256", secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const valid = expected.length === razorpay_signature?.length && timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!valid) return Response.json({ error: "Invalid payment signature" }, { status: 400 });
  const db = await getDb();
  await db.collection("orders").updateOne({ _id: new ObjectId(mongoOrderId), razorpayOrderId: razorpay_order_id }, { $set: { paymentStatus:"paid", orderStatus:"placed", razorpayPaymentId:razorpay_payment_id, updatedAt:new Date() } });
  return Response.json({ verified: true });
}

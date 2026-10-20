import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/mongodb";
import { finalizePaidOrder } from "@/lib/payment-finalize";
import { applyRateLimit } from "@/lib/rate-limiter";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const limited = applyRateLimit(request, "write");
  if (limited) return limited;
  const { mongoOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = await request.json();
  if (![mongoOrderId, razorpay_order_id, razorpay_payment_id, razorpay_signature].every((value) => typeof value === "string" && value.length)) return Response.json({ error: "Missing payment verification details" }, { status: 400 });
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return Response.json({ error: "Payment verification is not configured" }, { status: 503 });
  const expected = createHmac("sha256", secret).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest("hex");
  const valid = expected.length === razorpay_signature?.length && timingSafeEqual(Buffer.from(expected), Buffer.from(razorpay_signature));
  if (!valid) return Response.json({ error: "Invalid payment signature" }, { status: 400 });
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${secret}`).toString("base64");
  const paymentResponse = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, { headers: { Authorization: `Basic ${auth}` } });
  const payment = paymentResponse.ok ? await paymentResponse.json() as { status?: string; order_id?: string } : null;
  if (!payment || payment.status !== "captured" || payment.order_id !== razorpay_order_id) return Response.json({ error: "Payment is not captured yet" }, { status: 409 });
  const db = await getDb();
  await finalizePaidOrder(db, razorpay_order_id, razorpay_payment_id);
  return Response.json({ verified: true, idempotent: true });
}

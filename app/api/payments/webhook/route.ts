import { createHmac, timingSafeEqual } from "crypto";
import { getDb } from "@/lib/mongodb";
import { finalizePaidOrder } from "@/lib/payment-finalize";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  const body = await request.text(); const signature = request.headers.get("x-razorpay-signature") || "";
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  const payload = JSON.parse(body) as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; status?: string } } } };
  const payment = payload.payload?.payment?.entity;
  if (payload.event === "payment.captured" && payment?.id && payment.order_id && payment.status === "captured") await finalizePaidOrder(await getDb(), payment.order_id, payment.id);
  return Response.json({ received: true });
}

import { getDb } from "@/lib/mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { expireAwaitingOrders } from "@/lib/order-maintenance";
import { getFirebaseUser } from "@/lib/firebase-server";
import { isAdminEmail } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in to view the admin dashboard." }, { status: 401 });
  if (!isAdminEmail(user.email)) return Response.json({ error: "You do not have administrator access." }, { status: 403 });
  try {
    const db = await getDb();
    await ensureCollections(db);
    await expireAwaitingOrders(db);
    const [inventoryCount, orderCount, paymentCount, successfulPayments, awaitingPayment, expiredOrders, orders, payments] = await Promise.all([
      db.collection("inventory").countDocuments(),
      db.collection("orders").countDocuments(),
      db.collection("payments").countDocuments(),
      db.collection("payments").aggregate([{ $match: { paymentStatus: "paid" } }, { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$amount" } } }]).toArray(),
      db.collection("orders").countDocuments({ orderStatus: "awaiting_payment" }),
      db.collection("orders").countDocuments({ orderStatus: "expired" }),
      db.collection("orders").find({}, { projection: { orderNumber: 1, userId: 1, customer: 1, lines: 1, summary: 1, total: 1, currency: 1, paymentStatus: 1, paymentMethod: 1, orderStatus: 1, fulfillmentStatus: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(200).toArray(),
      db.collection("payments").find({}, { projection: { orderId: 1, orderNumber: 1, userId: 1, amount: 1, currency: 1, paymentMethod: 1, paymentStatus: 1, paymentReferenceId: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(200).toArray(),
    ]);
    return Response.json({
      stats: { inventoryCount, orderCount, paymentCount, successfulPayments: successfulPayments[0]?.count || 0, successfulRevenue: successfulPayments[0]?.total || 0, awaitingPayment, expiredOrders },
      orders: orders.map(({ _id, ...order }) => ({ id: _id.toString(), ...order })),
      payments: payments.map(({ _id, orderId, ...payment }) => ({ id: _id.toString(), orderId: orderId.toString(), ...payment })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/admin/dashboard error:", error);
    return Response.json({ error: "Unable to load order and payment activity" }, { status: 500 });
  }
}

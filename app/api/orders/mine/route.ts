import { getFirebaseUserId } from "@/lib/firebase-server";
import { getDb } from "@/lib/mongodb";
import { expireAwaitingOrders } from "@/lib/order-maintenance";

export const dynamic = "force-dynamic";

const sortOptions = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  total_high: { total: -1 },
  total_low: { total: 1 },
} as const;

export async function GET(request: Request) {
  const userId = await getFirebaseUserId(request);
  if (!userId) return Response.json({ error: "Please sign in to view your orders" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim();
  const status = searchParams.get("status");
  const paymentMethod = searchParams.get("paymentMethod");
  const sort = searchParams.get("sort") as keyof typeof sortOptions | null;
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit")) || 50));
  const filter: Record<string, unknown> = { userId };
  if (status && status !== "all") filter.orderStatus = status;
  if (paymentMethod && paymentMethod !== "all") filter.paymentMethod = paymentMethod;
  if (search) filter.$or = [
    { orderNumber: { $regex: search, $options: "i" } },
    { "lines.name": { $regex: search, $options: "i" } },
    { "lines.sku": { $regex: search, $options: "i" } },
  ];
  try {
    const db = await getDb();
    await expireAwaitingOrders(db);
    const [orders, total] = await Promise.all([db.collection("orders").find(filter).sort(sortOptions[sort || "newest"]).skip((page - 1) * limit).limit(limit).toArray(), db.collection("orders").countDocuments(filter)]);
    return Response.json({ orders: orders.map(({ _id, ...order }) => ({ id: _id.toString(), ...order })), total, page, limit, hasMore: page * limit < total }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GET /api/orders/mine error:", error);
    return Response.json({ error: "Unable to load your orders" }, { status: 500 });
  }
}

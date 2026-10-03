import { getDb } from "@/lib/mongodb";
import { expireAwaitingOrders } from "@/lib/order-maintenance";

export const runtime = "nodejs";

function hasCronAccess(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!hasCronAccess(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await expireAwaitingOrders(await getDb()));
}

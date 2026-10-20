import { getFirebaseUser } from "@/lib/firebase-server";
import { getDb } from "@/lib/mongodb";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import { ensureUserRole } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const limited = applyRateLimit(request, "standard");
    if (limited) return limited;
  const user = await getFirebaseUser(request);
  if (!user) return Response.json({ error: "Please sign in to load your role." }, { status: 401 });
  try {
    const db = await getDb();
    await ensureCollections(db);
    const role = await ensureUserRole(db, user);
    return Response.json({ userId: role.userId, role: role.role, permissions: role.permissions, active: role.active }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to load user role." }, { status: 500 });
  }
}

import { mongoHealth } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET() {
  const mongo = await mongoHealth();
  return Response.json(
    { service: "nammacare", status: mongo.status === "healthy" ? "healthy" : "degraded", mongo, checkedAt: new Date().toISOString() },
    { status: mongo.status === "healthy" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

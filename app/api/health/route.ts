import { mongoHealth } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET() {
  const mongo = await mongoHealth();
  const isOk = mongo.status === "healthy" || mongo.status === "unconfigured";
  return Response.json(
    {
      service: "aaroda-books-and-stationery",
      status: mongo.status === "healthy" ? "healthy" : mongo.status === "unconfigured" ? "local_prototype" : "degraded",
      mongo,
      checkedAt: new Date().toISOString(),
    },
    {
      status: isOk ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

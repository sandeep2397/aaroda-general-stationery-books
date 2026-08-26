import { getDb } from "@/lib/mongodb";
import { seedInventory } from "@/lib/catalog";
import { ensureCollections } from "@/lib/mongo-schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!process.env.MONGODB_URI) {
      const { searchParams } = new URL(request.url);
      const category = searchParams.get("category"), search = searchParams.get("search")?.trim().toLowerCase();
      const items = seedInventory.filter((item) => (!category || category === "All" || item.category === category) && (!search || `${item.name} ${item.description} ${item.sku}`.toLowerCase().includes(search)));
      return Response.json({ items: items.map((item, index) => ({ id: `seed-${index + 1}`, ...item })), source: "prototype" });
    }
    const db = await getDb();
    await ensureCollections(db);
    const collection = db.collection("inventory");
    if (await collection.countDocuments() === 0) await collection.insertMany(seedInventory);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category"), search = searchParams.get("search")?.trim();
    const filter: Record<string, unknown> = { active: true, stock: { $gt: 0 } };
    if (category && category !== "All") filter.category = category;
    if (search) filter.$or = [{ name: { $regex: search, $options: "i" } }, { description: { $regex: search, $options: "i" } }, { sku: { $regex: search, $options: "i" } }];
    const items = await collection.find(filter).sort({ category: 1, name: 1 }).limit(100).toArray();
    return Response.json({ items: items.map(({ _id, ...item }) => ({ id: _id.toString(), ...item })) });
  } catch (error) {
    console.error(error);
    return Response.json({ error: "Inventory is temporarily unavailable" }, { status: 500 });
  }
}

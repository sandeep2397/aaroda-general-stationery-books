import { getDb } from "@/lib/mongodb";
import {
  getLocalInventory,
  upsertLocalInventoryItem,
  deleteLocalInventoryItem,
  seedInventory,
} from "@/lib/catalog";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import { ObjectId } from "mongodb";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "standard");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const search = searchParams.get("search")?.trim().toLowerCase();
  const isAdmin = searchParams.get("admin") === "true";
  const includeInactive = searchParams.get("includeInactive") === "true" || isAdmin;

  try {
    if (!process.env.MONGODB_URI) {
      let items = getLocalInventory();
      if (!includeInactive) {
        items = items.filter((item) => item.active && item.stock > 0);
      }
      if (category && category !== "All") {
        items = items.filter((item) => item.category.toLowerCase() === category.toLowerCase());
      }
      if (search) {
        items = items.filter((item) =>
          `${item.name} ${item.description} ${item.sku} ${item.category} ${item.hsn || ""}`.toLowerCase().includes(search)
        );
      }
      return Response.json({
        items,
        source: "local_prototype",
        total: items.length,
      });
    }

    const db = await getDb();
    await ensureCollections(db);
    const collection = db.collection("inventory");

    if ((await collection.countDocuments()) === 0) {
      await collection.insertMany(
        seedInventory.map((item) => ({
          sku: item.sku,
          name: item.name,
          category: item.category,
          description: item.description,
          price: item.price,
          mrp: item.mrp,
          stock: item.stock,
          unit: item.unit,
          icon: item.icon,
          imageUrl: item.imageUrl || "",
          active: item.active,
          source: item.source,
          version: item.version || 1,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }))
      );
    }

    const filter: Record<string, unknown> = {};
    if (!includeInactive) {
      filter.active = true;
      filter.stock = { $gt: 0 };
    }
    if (category && category !== "All") {
      filter.category = { $regex: `^${category}$`, $options: "i" };
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { hsn: { $regex: search, $options: "i" } },
        { invoiceNo: { $regex: search, $options: "i" } },
      ];
    }

    const items = await collection.find(filter).sort({ category: 1, name: 1 }).limit(300).toArray();
    return Response.json({
      items: items.map(({ _id, ...item }) => ({ id: _id.toString(), ...item, version: item.version || 1 })),
      source: "mongodb_cluster",
      total: items.length,
    });
  } catch (error) {
    console.error("GET /api/inventory error:", error);
    let items = getLocalInventory();
    if (!includeInactive) {
      items = items.filter((item) => item.active && item.stock > 0);
    }
    if (category && category !== "All") {
      items = items.filter((item) => item.category.toLowerCase() === category.toLowerCase());
    }
    if (search) {
      items = items.filter((item) =>
        `${item.name} ${item.description} ${item.sku}`.toLowerCase().includes(search)
      );
    }
    return Response.json({
      items,
      source: "local_prototype",
      warning: error instanceof Error ? error.message : "Database connection failed, served from cache",
    });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "write");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const {
      sku,
      name,
      category,
      description,
      price,
      mrp,
      stock,
      unit,
      icon,
      imageUrl,
      active,
      version,
      hsn,
      gstPercent,
      netRate,
      baseRate,
      invoiceNo,
      metadata,
    } = body;

    if (!sku || !sku.trim()) {
      return Response.json({ error: "SKU is required" }, { status: 400 });
    }
    if (!name || !name.trim()) {
      return Response.json({ error: "Item name is required" }, { status: 400 });
    }
    if (price === undefined || isNaN(Number(price)) || Number(price) < 0) {
      return Response.json({ error: "Valid price is required" }, { status: 400 });
    }

    const cleanSku = String(sku).trim().toUpperCase();
    const cleanName = String(name).trim();
    const cleanCategory = category ? String(category).trim() : "General";
    const cleanPrice = Number(price);
    const cleanMrp = Number(mrp) || cleanPrice;
    const cleanStock = isNaN(Number(stock)) ? 0 : Number(stock);
    const cleanUnit = unit ? String(unit).trim() : "piece";
    const cleanIcon =
      icon ? String(icon).trim() : cleanCategory === "Medicine" ? "💊" : cleanCategory === "Stationery" ? "✏️" : "📦";
    const cleanImageUrl = imageUrl ? String(imageUrl).trim() : "";
    const cleanActive = active !== false;
    const cleanDescription = description ? String(description).trim() : "";
    const now = new Date();

    if (!process.env.MONGODB_URI) {
      const item = upsertLocalInventoryItem({
        sku: cleanSku,
        name: cleanName,
        category: cleanCategory,
        description: cleanDescription,
        price: cleanPrice,
        mrp: cleanMrp,
        stock: cleanStock,
        unit: cleanUnit,
        icon: cleanIcon,
        imageUrl: cleanImageUrl,
        active: cleanActive,
        source: "admin",
        hsn,
        gstPercent: gstPercent ? Number(gstPercent) : undefined,
        netRate: netRate ? Number(netRate) : undefined,
        baseRate: baseRate ? Number(baseRate) : undefined,
        invoiceNo,
        metadata,
      });
      return Response.json({ success: true, item, source: "local_prototype" });
    }

    const db = await getDb();
    await ensureCollections(db);
    const collection = db.collection("inventory");

    // Optimistic locking check if updating existing item
    if (version !== undefined) {
      const existing = await collection.findOne({ sku: cleanSku });
      if (existing && existing.version && existing.version !== Number(version)) {
        return Response.json(
          {
            error: "Optimistic Lock Conflict: Item was modified by another concurrent user. Please refresh and retry.",
            code: "OPTIMISTIC_LOCK_CONFLICT",
            currentVersion: existing.version,
            attemptedVersion: Number(version),
          },
          { status: 409 }
        );
      }
    }

    const updateDoc = {
      $set: {
        sku: cleanSku,
        name: cleanName,
        category: cleanCategory,
        description: cleanDescription,
        price: cleanPrice,
        mrp: cleanMrp,
        stock: cleanStock,
        unit: cleanUnit,
        icon: cleanIcon,
        imageUrl: cleanImageUrl,
        active: cleanActive,
        source: "admin",
        ...(hsn ? { hsn: String(hsn) } : {}),
        ...(gstPercent !== undefined ? { gstPercent: Number(gstPercent) } : {}),
        ...(netRate !== undefined ? { netRate: Number(netRate) } : {}),
        ...(baseRate !== undefined ? { baseRate: Number(baseRate) } : {}),
        ...(invoiceNo ? { invoiceNo: String(invoiceNo) } : {}),
        ...(metadata ? { metadata } : {}),
        updatedAt: now,
      },
      $inc: {
        version: 1,
      },
      $setOnInsert: {
        createdAt: now,
      },
    };

    const result = await collection.updateOne({ sku: cleanSku }, updateDoc, { upsert: true });
    const saved = await collection.findOne({ sku: cleanSku });

    return Response.json({
      success: true,
      upsertedId: result.upsertedId,
      item: saved ? { id: saved._id.toString(), ...saved } : null,
      source: "mongodb_cluster",
    });
  } catch (error) {
    console.error("POST /api/inventory error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to save item" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "write");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const body = await request.json();
    const { sku, id, stock, price, active, version } = body;

    if (!sku && !id) {
      return Response.json({ error: "sku or id is required" }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (stock !== undefined) updateFields.stock = Number(stock);
    if (price !== undefined) updateFields.price = Number(price);
    if (active !== undefined) updateFields.active = Boolean(active);

    if (!process.env.MONGODB_URI) {
      const items = getLocalInventory();
      const target = items.find((i) => (sku && i.sku === sku) || (id && i.id === id));
      if (!target) return Response.json({ error: "Item not found" }, { status: 404 });
      
      // Local optimistic lock check
      if (version !== undefined && target.version && target.version !== Number(version)) {
        return Response.json(
          {
            error: "Optimistic Lock Conflict: Item was modified by another concurrent request.",
            code: "OPTIMISTIC_LOCK_CONFLICT",
            currentVersion: target.version,
            attemptedVersion: Number(version),
          },
          { status: 409 }
        );
      }

      Object.assign(target, updateFields);
      target.version = (target.version || 1) + 1;
      return Response.json({ success: true, item: target, source: "local_prototype" });
    }

    const db = await getDb();
    const collection = db.collection("inventory");

    const filter: Record<string, unknown> = {};
    if (id && ObjectId.isValid(id)) {
      filter._id = new ObjectId(id);
    } else if (sku) {
      filter.sku = sku;
    }

    // If version is provided, apply optimistic locking filter
    if (version !== undefined) {
      filter.$or = [{ version: Number(version) }, { version: { $exists: false } }];
    }

    const res = await collection.updateOne(filter, {
      $set: updateFields,
      $inc: { version: 1 },
    });

    if (res.matchedCount === 0) {
      // Check if document exists with a different version (Optimistic lock conflict)
      const queryCheck: Record<string, unknown> = {};
      if (id && ObjectId.isValid(id)) queryCheck._id = new ObjectId(id);
      else if (sku) queryCheck.sku = sku;

      const existingDoc = await collection.findOne(queryCheck);
      if (existingDoc) {
        return Response.json(
          {
            error: "Conflict: This item was updated by another concurrent request. Please reload and retry.",
            code: "OPTIMISTIC_LOCK_CONFLICT",
            currentVersion: existingDoc.version || 1,
            attemptedVersion: version,
            item: { id: existingDoc._id.toString(), ...existingDoc },
          },
          { status: 409 }
        );
      }

      return Response.json({ error: "Item not found" }, { status: 404 });
    }

    return Response.json({ success: true, modifiedCount: res.modifiedCount });
  } catch (error) {
    console.error("PATCH /api/inventory error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update item" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "write");
  if (rateLimitResponse) return rateLimitResponse;

  try {
    const { searchParams } = new URL(request.url);
    const sku = searchParams.get("sku");
    const id = searchParams.get("id");

    if (!sku && !id) {
      return Response.json({ error: "sku or id is required" }, { status: 400 });
    }

    if (!process.env.MONGODB_URI) {
      const deleted = deleteLocalInventoryItem(sku || id || "");
      return Response.json({ success: deleted, source: "local_prototype" });
    }

    const db = await getDb();
    const collection = db.collection("inventory");
    const query: Record<string, unknown> = {};
    if (id && ObjectId.isValid(id)) {
      query._id = new ObjectId(id);
    } else if (sku) {
      query.sku = sku;
    }

    const result = await collection.deleteOne(query);
    return Response.json({ success: result.deletedCount > 0, deletedCount: result.deletedCount });
  } catch (error) {
    console.error("DELETE /api/inventory error:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete item" }, { status: 500 });
  }
}

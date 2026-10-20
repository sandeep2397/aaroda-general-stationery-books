import { getDb } from "@/lib/mongodb";
import {
  getLocalInventory,
  upsertLocalInventoryItem,
  deleteLocalInventoryItem,
  seedInventory,
} from "@/lib/catalog";
import { ensureCollections } from "@/lib/mongo-schema";
import { applyRateLimit } from "@/lib/rate-limiter";
import { Document, ObjectId } from "mongodb";
import { getFirebaseUser } from "@/lib/firebase-server";
import { isAdminEmail } from "@/lib/admin";
import { CATEGORY_TYPES } from "@/lib/mongo-schema";

export const dynamic = "force-dynamic";

async function requireAdmin(request: Request) {
  const user = await getFirebaseUser(request);
  return Boolean(user && isAdminEmail(user.email));
}

export async function GET(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "standard");
  if (rateLimitResponse) return rateLimitResponse;

  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const categoryType = searchParams.get("categoryType") || category;
  const search = searchParams.get("search")?.trim().toLowerCase();
  const isAdmin = searchParams.get("admin") === "true";
  const includeInactive = searchParams.get("includeInactive") === "true" || isAdmin;
  const statsOnly = searchParams.get("stats") === "true";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 24));

  try {
    if (!process.env.MONGODB_URI) {
      let items = getLocalInventory();
      if (statsOnly) return Response.json({ totalSkus: items.length, totalStock: items.reduce((sum, item) => sum + (item.stock || 0), 0), medicines: items.filter(item => item.category.toLowerCase().includes("med")).length, stationery: items.filter(item => item.category.toLowerCase().includes("stat")).length });
      if (!includeInactive) {
        items = items.filter((item) => item.active && item.stock > 0);
      }
      if (categoryType && categoryType !== "All") {
        items = items.filter((item) => (item.categoryType || item.category).toLowerCase() === categoryType.toLowerCase());
      }
      if (search) {
        items = items.filter((item) =>
          `${item.name} ${item.description} ${item.sku} ${item.category} ${item.categoryType || ""} ${item.hsn || ""}`.toLowerCase().includes(search)
        );
      }
      const total = items.length;
      return Response.json({
        items: items.slice((page - 1) * limit, page * limit),
        source: "local_prototype",
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      });
    }

    const db = await getDb();
    await ensureCollections(db);
    const collection = db.collection("inventory");

    if (statsOnly) {
      const [stats] = await collection.aggregate([{ $group: { _id: null, totalSkus: { $sum: 1 }, totalStock: { $sum: "$stock" }, medicines: { $sum: { $cond: [{ $regexMatch: { input: "$category", regex: "med", options: "i" } }, 1, 0] } }, stationery: { $sum: { $cond: [{ $regexMatch: { input: "$category", regex: "stat", options: "i" } }, 1, 0] } } } }]).toArray();
      return Response.json(stats || { totalSkus: 0, totalStock: 0, medicines: 0, stationery: 0 });
    }

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
          imageUrl: Array.isArray(item.imageUrl) ? item.imageUrl : item.imageUrl ? [item.imageUrl] : [],
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
    if (categoryType && categoryType !== "All") {
      filter.categoryType = { $regex: `^${categoryType}$`, $options: "i" };
    }
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { sku: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { categoryType: { $regex: search, $options: "i" } },
        { hsn: { $regex: search, $options: "i" } },
        { invoiceNo: { $regex: search, $options: "i" } },
      ];
    }

    let items: Document[] = [];
    let total = 0;
    if (search) {
      try {
        const atlasSearchIndex = process.env.MONGODB_ATLAS_SEARCH_INDEX || "inventory_search";
        const searchFilter = { ...filter }; delete searchFilter.$or;
        const pipeline = [{ $search: { index: atlasSearchIndex, text: { query: search, path: ["name", "description", "sku", "categoryType", "category"] } } }, { $match: searchFilter }, { $sort: { name: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }];
        items = await collection.aggregate(pipeline).toArray();
        total = (await collection.aggregate([{ $search: { index: atlasSearchIndex, text: { query: search, path: ["name", "description", "sku", "categoryType", "category"] } } }, { $match: searchFilter }, { $count: "total" }]).toArray())[0]?.total || 0;
      } catch { /* Atlas Search is optional; indexed regex/text fallback remains available. */ }
    }
    if (!items.length && total === 0) { total = await collection.countDocuments(filter); items = await collection.find(filter).sort({ categoryType: 1, name: 1 }).skip((page - 1) * limit).limit(limit).toArray(); }
    return Response.json({
      items: items.map(({ _id, ...item }) => ({ id: _id.toString(), ...item, version: item.version || 1 })),
      source: "mongodb_cluster",
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("GET /api/inventory error:", error);
    let items = getLocalInventory();
    if (!includeInactive) {
      items = items.filter((item) => item.active && item.stock > 0);
    }
    if (categoryType && categoryType !== "All") {
      items = items.filter((item) => (item.categoryType || item.category).toLowerCase() === categoryType.toLowerCase());
    }
    if (search) {
      items = items.filter((item) =>
        `${item.name} ${item.description} ${item.sku} ${item.categoryType || ""}`.toLowerCase().includes(search)
      );
    }
    const total = items.length;
    return Response.json({
      items: items.slice((page - 1) * limit, page * limit),
      source: "local_prototype",
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      warning: error instanceof Error ? error.message : "Database connection failed, served from cache",
    });
  }
}

export async function POST(request: Request) {
  const rateLimitResponse = applyRateLimit(request, "write");
  if (rateLimitResponse) return rateLimitResponse;
  if (!await requireAdmin(request)) return Response.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const body = await request.json();
    const {
      sku,
      name,
      category,
      categoryType,
      description,
      price,
      mrp,
      stock,
      unit,
      icon,
      imageUrl, imageUrls, imageMetadata,
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
    const cleanCategoryType = String(categoryType || body.categoryType || "").trim();
    if (!CATEGORY_TYPES.includes(cleanCategoryType as typeof CATEGORY_TYPES[number])) return Response.json({ error: "A valid category type is required." }, { status: 400 });
    const cleanPrice = Number(price);
    const cleanMrp = Number(mrp) || cleanPrice;
    const cleanStock = isNaN(Number(stock)) ? 0 : Number(stock);
    const cleanUnit = unit ? String(unit).trim() : "piece";
    const cleanIcon =
      icon ? String(icon).trim() : cleanCategoryType === "Stationery" ? "✏️" : cleanCategoryType === "Personal Care" ? "🧴" : "📦";
    const cleanImageUrls = Array.isArray(imageUrls) ? imageUrls.filter((url): url is string => typeof url === "string" && Boolean(url.trim())).map((url) => url.trim()) : imageUrl ? [String(imageUrl).trim()] : [];
    const cleanActive = active !== false;
    const cleanDescription = description ? String(description).trim() : "";
    const now = new Date();

    if (!process.env.MONGODB_URI) {
      const item = upsertLocalInventoryItem({
        sku: cleanSku,
        name: cleanName,
        category: cleanCategory,
        categoryType: cleanCategoryType as "Stationery" | "Personal Care" | "Kids" | "Electronics" | "Beauty" | "Decor",
        description: cleanDescription,
        price: cleanPrice,
        mrp: cleanMrp,
        stock: cleanStock,
        unit: cleanUnit,
        icon: cleanIcon,
        imageUrl: cleanImageUrls,
        imageUrls: cleanImageUrls,
        imageMetadata: Array.isArray(imageMetadata) ? imageMetadata : [],
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
        categoryType: cleanCategoryType,
        description: cleanDescription,
        price: cleanPrice,
        mrp: cleanMrp,
        stock: cleanStock,
        unit: cleanUnit,
        icon: cleanIcon,
        imageUrl: cleanImageUrls,
        imageUrls: cleanImageUrls,
        imageMetadata: Array.isArray(imageMetadata) ? imageMetadata : [],
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
  if (!await requireAdmin(request)) return Response.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const body = await request.json();
    const { sku, id, version } = body;

    if (!sku && !id) {
      return Response.json({ error: "sku or id is required" }, { status: 400 });
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    const stringFields = ["sku", "name", "category", "categoryType", "description", "unit", "icon", "hsn", "invoiceNo"] as const;
    const numberFields = ["stock", "price", "mrp", "gstPercent", "netRate", "baseRate"] as const;
    for (const field of stringFields) if (body[field] !== undefined) updateFields[field] = String(body[field]).trim();
    if (updateFields.categoryType && !CATEGORY_TYPES.includes(updateFields.categoryType as typeof CATEGORY_TYPES[number])) return Response.json({ error: "A valid category type is required." }, { status: 400 });
    for (const field of numberFields) if (body[field] !== undefined && !Number.isNaN(Number(body[field]))) updateFields[field] = Number(body[field]);
    if (body.active !== undefined) updateFields.active = Boolean(body.active);
    if (Array.isArray(body.imageUrls)) updateFields.imageUrls = body.imageUrls.filter((url: unknown): url is string => typeof url === "string" && Boolean(url.trim())).map((url: string) => url.trim());
    if (Array.isArray(updateFields.imageUrls)) updateFields.imageUrl = updateFields.imageUrls;
    if (Array.isArray(body.imageMetadata)) updateFields.imageMetadata = body.imageMetadata;

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
  if (!await requireAdmin(request)) return Response.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("bulk") === "true") {
      const { skus } = await request.json() as { skus?: string[] };
      if (!Array.isArray(skus) || !skus.length) return Response.json({ error: "skus is required" }, { status: 400 });
      if (!process.env.MONGODB_URI) { const deletedCount = skus.filter(deleteLocalInventoryItem).length; return Response.json({ success: true, deletedCount, source: "local_prototype" }); }
      const db = await getDb(); const result = await db.collection("inventory").deleteMany({ sku: { $in: skus } });
      return Response.json({ success: true, deletedCount: result.deletedCount });
    }
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

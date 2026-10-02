import type { Db } from "mongodb";

export const inventoryExcelColumns = [
  "sr",
  "sku",
  "name",
  "particulars",
  "category",
  "description",
  "hsn",
  "gstPercent",
  "stock",
  "qty",
  "price",
  "netRate",
  "baseRate",
  "mrp",
  "unit",
  "icon",
  "imageUrl",
  "invoiceNo",
  "invoiceDate",
  "supplier",
  "active"
] as const;

const inventoryValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["sku", "name", "price", "stock", "active"],
    properties: {
      sku: { bsonType: "string" },
      name: { bsonType: "string" },
      category: { bsonType: "string" },
      description: { bsonType: "string" },
      price: { bsonType: ["int", "long", "double", "decimal"] },
      mrp: { bsonType: ["int", "long", "double", "decimal"] },
      stock: { bsonType: ["int", "long", "double", "decimal"] },
      unit: { bsonType: "string" },
      icon: { bsonType: "string" },
      imageUrl: { bsonType: "string" },
      active: { bsonType: "bool" },
      source: { bsonType: "string" },
      version: { bsonType: ["int", "long", "double"] },
      hsn: { bsonType: "string" },
      gstPercent: { bsonType: ["int", "long", "double", "decimal"] },
      netRate: { bsonType: ["int", "long", "double", "decimal"] },
      baseRate: { bsonType: ["int", "long", "double", "decimal"] },
      invoiceNo: { bsonType: "string" },
      metadata: { bsonType: "object" },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const orderValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orderNumber", "lines", "total", "paymentStatus", "orderStatus", "createdAt"],
    properties: {
      orderNumber: { bsonType: "string" },
      lines: { bsonType: "array" },
      subtotal: { bsonType: ["int", "long", "double", "decimal"] },
      delivery: { bsonType: ["int", "long", "double", "decimal"] },
      total: { bsonType: ["int", "long", "double", "decimal"] },
      currency: { enum: ["INR"] },
      paymentStatus: { enum: ["created", "paid", "failed"] },
      orderStatus: { enum: ["awaiting_payment", "placed", "cancelled"] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

export async function ensureCollections(db: Db) {
  try {
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name));
    if (!existing.has("inventory")) {
      await db.createCollection("inventory", { validator: inventoryValidator }).catch(() => undefined);
    } else {
      await db.command({
        collMod: "inventory",
        validator: inventoryValidator,
        validationLevel: "moderate",
      }).catch(() => undefined);
    }
    if (!existing.has("orders")) {
      await db.createCollection("orders", { validator: orderValidator }).catch(() => undefined);
    }
    await db.collection("inventory").createIndex({ sku: 1 }, { unique: true }).catch(() => undefined);
    await db.collection("orders").createIndex({ orderNumber: 1 }, { unique: true }).catch(() => undefined);
  } catch (err) {
    console.warn("Collection init warning:", err);
  }
}

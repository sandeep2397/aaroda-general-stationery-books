import type { Db } from "mongodb";

export const inventoryExcelColumns = [
  "sr",
  "sku",
  "name",
  "particulars",
  "category",
  "categoryType",
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

export const CATEGORY_TYPES = ["Stationery", "Personal Care", "Kids", "Electronics", "Beauty", "Decor"] as const;
export type CategoryType = typeof CATEGORY_TYPES[number];

const inventoryValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["sku", "name", "categoryType", "price", "stock", "active"],
    properties: {
      sku: { bsonType: "string" },
      name: { bsonType: "string" },
      category: { bsonType: "string" },
      categoryType: { enum: CATEGORY_TYPES },
      description: { bsonType: "string" },
      price: { bsonType: ["int", "long", "double", "decimal"] },
      mrp: { bsonType: ["int", "long", "double", "decimal"] },
      stock: { bsonType: ["int", "long", "double", "decimal"] },
      unit: { bsonType: "string" },
      icon: { bsonType: "string" },
      imageUrl: { bsonType: "array", items: { bsonType: "string" } },
      imageUrls: { bsonType: "array" },
      imageMetadata: { bsonType: "array" },
      active: { bsonType: "bool" },
      source: { bsonType: "string" },
      version: { bsonType: ["int", "long", "double"] },
      reservedStock: { bsonType: ["int", "long", "double"] },
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
    required: ["orderNumber", "userId", "lines", "summary", "total", "deliveryAddress", "paymentStatus", "orderStatus", "createdAt"],
    properties: {
      orderNumber: { bsonType: "string" },
      userId: { bsonType: "string" },
      customer: { bsonType: "object" },
      deliveryAddress: { bsonType: "object" },
      idempotencyKey: { bsonType: "string" },
      lines: { bsonType: "array" },
      summary: { bsonType: "object" },
      subtotal: { bsonType: ["int", "long", "double", "decimal"] },
      delivery: { bsonType: ["int", "long", "double", "decimal"] },
      total: { bsonType: ["int", "long", "double", "decimal"] },
      currency: { enum: ["INR"] },
      paymentStatus: { enum: ["created", "paid", "failed", "cash_on_delivery", "expired"] },
      orderStatus: { enum: ["awaiting_payment", "placed", "accepted", "declined", "cancelled", "expired"] },
      fulfillmentStatus: { enum: ["received", "accepted", "declined", "shipped", "delivered"] },
      createdAt: { bsonType: "date" },
      updatedAt: { bsonType: "date" }
    }
  }
};

const addressValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["userId", "label", "recipientName", "phone", "line1", "city", "state", "postalCode", "createdAt", "updatedAt"],
    properties: {
      userId: { bsonType: "string" }, label: { bsonType: "string" }, recipientName: { bsonType: "string" }, phone: { bsonType: "string" },
      line1: { bsonType: "string" }, line2: { bsonType: "string" }, landmark: { bsonType: "string" }, city: { bsonType: "string" }, state: { bsonType: "string" }, postalCode: { bsonType: "string" },
      location: { bsonType: "object" }, isDefault: { bsonType: "bool" }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" },
    },
  },
};

const userValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["userId", "email", "addresses", "createdAt", "updatedAt"],
    properties: {
      userId: { bsonType: "string" }, email: { bsonType: "string" }, displayName: { bsonType: "string" }, photoURL: { bsonType: "string" },
      addresses: { bsonType: "array", items: { bsonType: "object" } }, lastAddressSavedAt: { bsonType: "date" }, createdAt: { bsonType: "date" }, updatedAt: { bsonType: "date" },
    },
  },
};

const paymentValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["orderId", "userId", "amount", "currency", "paymentMethod", "paymentStatus", "createdAt"],
    properties: {
      orderId: { bsonType: "objectId" },
      userId: { bsonType: "string" },
      orderNumber: { bsonType: "string" },
      amount: { bsonType: ["int", "long", "double", "decimal"] },
      currency: { enum: ["INR"] },
      paymentMethod: { enum: ["razorpay", "cod"] },
      paymentStatus: { enum: ["paid", "cash_on_delivery", "failed"] },
      paymentReferenceId: { bsonType: "string" },
      razorpayOrderId: { bsonType: "string" },
      razorpayPaymentId: { bsonType: "string" },
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
    } else {
      await db.command({ collMod: "orders", validator: orderValidator, validationLevel: "moderate" }).catch(() => undefined);
    }
    if (!existing.has("payments")) {
      await db.createCollection("payments", { validator: paymentValidator }).catch(() => undefined);
    } else {
      await db.command({ collMod: "payments", validator: paymentValidator, validationLevel: "moderate" }).catch(() => undefined);
    }
    if (!existing.has("addresses")) await db.createCollection("addresses", { validator: addressValidator }).catch(() => undefined);
    else await db.command({ collMod: "addresses", validator: addressValidator, validationLevel: "moderate" }).catch(() => undefined);
    if (!existing.has("users")) await db.createCollection("users", { validator: userValidator }).catch(() => undefined);
    else await db.command({ collMod: "users", validator: userValidator, validationLevel: "moderate" }).catch(() => undefined);
    await db.collection("orders").updateMany({ paymentStatus: "pending_cod" }, { $set: { paymentStatus: "cash_on_delivery", updatedAt: new Date() } }).catch(() => undefined);
    await db.collection("payments").updateMany({ paymentStatus: "pending_cod" }, { $set: { paymentStatus: "cash_on_delivery", updatedAt: new Date() } }).catch(() => undefined);
    // Backfill legacy products once, mapping retired Medicine records into Personal Care.
    await db.collection("inventory").updateMany({ categoryType: { $exists: false } }, [{ $set: { categoryType: { $cond: [{ $eq: ["$category", "Stationery"] }, "Stationery", "Personal Care"] } } }]).catch(() => undefined);
    await db.collection("inventory").updateMany({ category: "Medicine" }, { $set: { category: "Personal Care", categoryType: "Personal Care", updatedAt: new Date() } }).catch(() => undefined);
    await db.collection("inventory").createIndex({ sku: 1 }, { unique: true }).catch(() => undefined);
    await db.collection("inventory").createIndex({ categoryType: 1, active: 1, stock: 1 }).catch(() => undefined);
    await db.collection("inventory").createIndex({ name: "text", description: "text", categoryType: "text", sku: "text" }, { name: "inventory_text_search" }).catch(() => undefined);
    await db.collection("orders").createIndex({ orderNumber: 1 }, { unique: true }).catch(() => undefined);
    await db.collection("orders").createIndex({ userId: 1, createdAt: -1 }).catch(() => undefined);
    await db.collection("orders").createIndex({ razorpayOrderId: 1 }, { unique: true, sparse: true }).catch(() => undefined);
    await db.collection("orders").createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true, sparse: true }).catch(() => undefined);
    await db.collection("payments").createIndex({ orderId: 1 }, { unique: true }).catch(() => undefined);
    await db.collection("payments").createIndex({ paymentReferenceId: 1 }, { unique: true, sparse: true }).catch(() => undefined);
    await db.collection("payments").createIndex({ userId: 1, createdAt: -1 }).catch(() => undefined);
    await db.collection("addresses").createIndex({ userId: 1, isDefault: -1, updatedAt: -1 }).catch(() => undefined);
    await db.collection("users").createIndex({ userId: 1 }, { unique: true }).catch(() => undefined);
  } catch (err) {
    console.warn("Collection init warning:", err);
  }
}

import type { Db } from "mongodb";

export const inventoryExcelColumns = ["sku", "name", "category", "description", "price", "mrp", "stock", "unit", "icon"] as const;

const inventoryValidator = { $jsonSchema: { bsonType:"object", required:["sku","name","category","price","stock","active","source"], properties:{ sku:{bsonType:"string"}, name:{bsonType:"string"}, category:{enum:["Medicine","Stationery"]}, description:{bsonType:"string"}, price:{bsonType:["int","long","double","decimal"]}, mrp:{bsonType:["int","long","double","decimal"]}, stock:{bsonType:["int","long","double","decimal"]}, unit:{bsonType:"string"}, icon:{bsonType:"string"}, active:{bsonType:"bool"}, source:{enum:["seed","excel"]}, createdAt:{bsonType:"date"}, updatedAt:{bsonType:"date"} } } };
const orderValidator = { $jsonSchema: { bsonType:"object", required:["orderNumber","lines","total","paymentStatus","orderStatus","createdAt"], properties:{ orderNumber:{bsonType:"string"}, lines:{bsonType:"array"}, subtotal:{bsonType:["int","long","double","decimal"]}, delivery:{bsonType:["int","long","double","decimal"]}, total:{bsonType:["int","long","double","decimal"]}, currency:{enum:["INR"]}, paymentStatus:{enum:["created","paid","failed"]}, orderStatus:{enum:["awaiting_payment","placed","cancelled"]}, createdAt:{bsonType:"date"}, updatedAt:{bsonType:"date"} } } };

export async function ensureCollections(db: Db) {
  const existing = new Set((await db.listCollections({}, { nameOnly:true }).toArray()).map(item=>item.name));
  if (!existing.has("inventory")) await db.createCollection("inventory", { validator: inventoryValidator });
  if (!existing.has("orders")) await db.createCollection("orders", { validator: orderValidator });
  await db.collection("inventory").createIndex({ sku:1 }, { unique:true });
  await db.collection("orders").createIndex({ orderNumber:1 }, { unique:true });
}

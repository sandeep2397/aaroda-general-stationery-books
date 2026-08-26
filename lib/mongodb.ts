import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "nammacare";

declare global { var nammaMongoClient: Promise<MongoClient> | undefined; }

export async function getDb(): Promise<Db> {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  if (!global.nammaMongoClient) global.nammaMongoClient = new MongoClient(uri).connect();
  return (await global.nammaMongoClient).db(dbName);
}

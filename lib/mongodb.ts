import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "nammacare";
const RETRY_DELAYS_MS = [0, 350, 900];

declare global {
  var nammaMongoClient: MongoClient | undefined;
  var nammaMongoConnecting: Promise<MongoClient> | undefined;
}

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function closeCachedClient() {
  const client = global.nammaMongoClient;
  global.nammaMongoClient = undefined;
  global.nammaMongoConnecting = undefined;
  if (client) await client.close().catch(() => undefined);
}

async function connectFresh(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  const client = new MongoClient(uri, {
    maxPoolSize: 8,
    minPoolSize: 0,
    maxIdleTimeMS: 45_000,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    socketTimeoutMS: 12_000,
    retryReads: true,
    retryWrites: true,
  });
  await client.connect();
  await client.db(dbName).command({ ping: 1 });
  global.nammaMongoClient = client;
  return client;
}

async function healthyCachedClient() {
  if (!global.nammaMongoClient) return undefined;
  try {
    await global.nammaMongoClient.db(dbName).command({ ping: 1 });
    return global.nammaMongoClient;
  } catch {
    await closeCachedClient();
    return undefined;
  }
}

export async function getDb(): Promise<Db> {
  const cached = await healthyCachedClient();
  if (cached) return cached.db(dbName);

  let lastError: unknown;
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await wait(delay);
    try {
      if (!global.nammaMongoConnecting) {
        global.nammaMongoConnecting = connectFresh().catch((error) => {
          global.nammaMongoConnecting = undefined;
          throw error;
        });
      }
      return (await global.nammaMongoConnecting).db(dbName);
    } catch (error) {
      lastError = error;
      await closeCachedClient();
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MongoDB connection failed");
}

export async function mongoHealth() {
  const startedAt = Date.now();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return { status: "healthy" as const, database: db.databaseName, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: "unavailable" as const, database: dbName, latencyMs: Date.now() - startedAt, reason: error instanceof Error ? error.message.replace(uri || "", "[redacted]") : "Connection failed" };
  }
}

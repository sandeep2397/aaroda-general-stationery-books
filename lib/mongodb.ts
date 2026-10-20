import { MongoClient, Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const readUris = (process.env.MONGODB_READ_URIS || "").split(",").map((value) => value.trim()).filter(Boolean);
const dbName = process.env.MONGODB_DB || "nammacare";
const RETRY_DELAYS_MS = [0, 350, 900];
const KEEP_ALIVE_INTERVAL_MS = 15_000;
const HEALTH_CHECK_INTERVAL_MS = 30_000;

interface MongoState {
  client?: MongoClient;
  connecting?: Promise<MongoClient>;
  keepAliveTimer?: NodeJS.Timeout;
  connectedSince?: Date;
  lastPingAt?: Date;
  lastPingLatencyMs?: number;
  pingSuccessCount: number;
  pingErrorCount: number;
  lastError?: string;
  readClients?: MongoClient[];
  readConnecting?: Promise<MongoClient[]>;
  readIndex?: number;
}

declare global {
  var nammaMongoState: MongoState | undefined;
}

function getState(): MongoState {
  if (!global.nammaMongoState) {
    global.nammaMongoState = {
      pingSuccessCount: 0,
      pingErrorCount: 0,
    };
  }
  return global.nammaMongoState;
}

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function sanitizeErrorMessage(msg: string): string {
  if (!uri) return msg;
  try {
    return msg.replace(uri, "[MONGODB_URI]").replace(/mongodb(\+srv)?:\/\/[^@]+@/, "mongodb+srv://***:***@");
  } catch {
    return "MongoDB connection error";
  }
}

async function closeCachedClient() {
  const state = getState();
  const client = state.client;
  state.client = undefined;
  state.connecting = undefined;
  state.connectedSince = undefined;
  if (client) {
    await client.close().catch(() => undefined);
  }
}

function startKeepAlivePing() {
  const state = getState();
  if (state.keepAliveTimer) return;

  state.keepAliveTimer = setInterval(async () => {
    if (!state.client) return;
    const start = Date.now();
    try {
      await state.client.db(dbName).command({ ping: 1 });
      state.lastPingAt = new Date();
      state.lastPingLatencyMs = Date.now() - start;
      state.pingSuccessCount += 1;
      state.lastError = undefined;
    } catch (err) {
      state.pingErrorCount += 1;
      state.lastError = err instanceof Error ? sanitizeErrorMessage(err.message) : "Ping failed";
      console.warn("[MongoDB Keep-Alive] Ping failed, recycling connection:", state.lastError);
      await closeCachedClient();
    }
  }, KEEP_ALIVE_INTERVAL_MS);

  if (typeof state.keepAliveTimer.unref === "function") {
    state.keepAliveTimer.unref();
  }
}

async function connectFresh(): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is not configured");
  
  // High-reliability connection pooling config
  const client = new MongoClient(uri, {
    // Serverless functions should open only the connection they need on cold start.
    minPoolSize: 0,
    maxPoolSize: 10,
    maxConnecting: 2,
    maxIdleTimeMS: 60_000, // Close idle connections after 60s
    waitQueueTimeoutMS: 10_000,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    socketTimeoutMS: 30_000,
    heartbeatFrequencyMS: 10_000, // Background driver heartbeat every 10s
    retryReads: true,
    retryWrites: true,
    // A write is acknowledged only after the replica set majority has it.
    writeConcern: { w: "majority", j: true },
    compressors: "zstd,snappy",
  });

  await client.connect();
  
  const state = getState();
  state.client = client;
  state.connectedSince = new Date();
  state.lastPingAt = undefined;
  state.lastPingLatencyMs = undefined;
  state.pingSuccessCount += 1;
  state.lastError = undefined;

  startKeepAlivePing();
  return client;
}

async function connectReadClients(): Promise<MongoClient[]> {
  const uris = readUris.length ? readUris : (uri ? [uri] : []);
  if (!uris.length) throw new Error("MONGODB_URI is not configured");
  const clients = await Promise.all(uris.map(async (readUri) => {
    const client = new MongoClient(readUri, {
      minPoolSize: 0, maxPoolSize: 10, maxConnecting: 2, maxIdleTimeMS: 60_000,
      waitQueueTimeoutMS: 10_000, serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000,
      retryReads: true, retryWrites: false, readPreference: "secondaryPreferred", compressors: "zstd,snappy",
      readConcern: "majority",
    });
    await client.connect();
    return client;
  }));
  return clients;
}

async function healthyCachedClient(): Promise<MongoClient | undefined> {
  const state = getState();
  if (!state.client) return undefined;
  if (state.lastPingAt && Date.now() - state.lastPingAt.getTime() < HEALTH_CHECK_INTERVAL_MS) {
    return state.client;
  }
  try {
    const start = Date.now();
    await state.client.db(dbName).command({ ping: 1 });
    state.lastPingAt = new Date();
    state.lastPingLatencyMs = Date.now() - start;
    return state.client;
  } catch {
    await closeCachedClient();
    return undefined;
  }
}

export async function getDb(): Promise<Db> {
  const cached = await healthyCachedClient();
  if (cached) return cached.db(dbName);

  const state = getState();
  let lastError: unknown;
  
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await wait(delay);
    try {
      if (!state.connecting) {
        state.connecting = connectFresh().catch((error) => {
          state.connecting = undefined;
          throw error;
        });
      }
      const client = await state.connecting;
      return client.db(dbName);
    } catch (error) {
      lastError = error;
      await closeCachedClient();
    }
  }
  
  const formattedError = lastError instanceof Error ? sanitizeErrorMessage(lastError.message) : "MongoDB connection failed";
  throw new Error(formattedError);
}

/** Read path with optional replica URIs. Set MONGODB_READ_URIS to a comma-separated
 * list of Atlas replica/region URIs; without it, reads safely fall back to the
 * pooled writer client. Writes always use getDb(). */
export async function getReadDb(): Promise<Db> {
  const state = getState();
  if (!readUris.length) return getDb();
  if (!state.readClients) {
    state.readConnecting ??= connectReadClients().then((clients) => {
      state.readClients = clients;
      state.readConnecting = undefined;
      state.readIndex = 0;
      return clients;
    }).catch((error) => {
      state.readConnecting = undefined;
      throw error;
    });
  }
  const clients = state.readClients || await state.readConnecting;
  if (!clients?.length) return getDb();
  const index = state.readIndex || 0;
  state.readIndex = (index + 1) % clients.length;
  return clients[index].db(dbName);
}

/** Use the primary for read-after-write flows where stale replica data is not acceptable. */
export async function getConsistentReadDb(): Promise<Db> {
  return getDb();
}

export async function mongoHealth() {
  const startedAt = Date.now();
  const state = getState();

  if (!uri) {
    return {
      status: "unconfigured" as const,
      database: dbName,
      latencyMs: 0,
      pool: { minPoolSize: 0, maxPoolSize: 0, active: false },
      message: "Running in local prototype mode. Set MONGODB_URI to connect to MongoDB cluster.",
      lastPingAt: state.lastPingAt?.toISOString(),
      stats: { success: state.pingSuccessCount, errors: state.pingErrorCount },
    };
  }

  try {
    const db = await getDb();
    const pingStart = Date.now();
    await db.command({ ping: 1 });
    const latency = Date.now() - pingStart;

    return {
      status: "healthy" as const,
      database: db.databaseName,
      latencyMs: latency,
      pool: {
        minPoolSize: 0,
        maxPoolSize: 10,
        active: true,
        connectedSince: state.connectedSince?.toISOString(),
      },
      lastPingAt: new Date().toISOString(),
      stats: {
        success: state.pingSuccessCount,
        errors: state.pingErrorCount,
      },
    };
  } catch (error) {
    return {
      status: "unavailable" as const,
      database: dbName,
      latencyMs: Date.now() - startedAt,
      pool: { minPoolSize: 0, maxPoolSize: 10, active: false },
      reason: error instanceof Error ? sanitizeErrorMessage(error.message) : "Connection failed",
      lastPingAt: state.lastPingAt?.toISOString(),
      stats: {
        success: state.pingSuccessCount,
        errors: state.pingErrorCount,
      },
    };
  }
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export const RATE_LIMIT_CONFIGS = {
  standard: { windowMs: 60_000, maxRequests: 120 }, // 120 req/min for reads
  write: { windowMs: 60_000, maxRequests: 40 },      // 40 req/min for writes
  bulk: { windowMs: 60_000, maxRequests: 15 },       // 15 req/min for bulk uploads
  health: { windowMs: 60_000, maxRequests: 180 },    // 180 req/min for health check pings
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_CONFIGS;

interface ClientRecord {
  timestamps: number[];
}

declare global {
  var nammaRateLimitMap: Map<string, ClientRecord> | undefined;
}

function getRateLimitMap(): Map<string, ClientRecord> {
  if (!global.nammaRateLimitMap) {
    global.nammaRateLimitMap = new Map();
  }
  return global.nammaRateLimitMap;
}

function pruneRateLimitMap(store: Map<string, ClientRecord>, now: number) {
  // Prevent an unbounded in-memory map in long-lived Node runtimes. Vercel
  // instances are isolated, so this is a safety guard rather than a substitute
  // for a distributed limiter (Redis can be added later if global enforcement is needed).
  if (store.size <= 10_000) return;
  for (const [key, record] of store) {
    if (record.timestamps.every((timestamp) => timestamp <= now - 60_000)) store.delete(key);
    if (store.size <= 8_000) break;
  }
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  return "127.0.0.1";
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds?: number;
  headers: Record<string, string>;
}

export function checkRateLimit(clientId: string, tier: RateLimitTier = "standard"): RateLimitResult {
  const config = RATE_LIMIT_CONFIGS[tier];
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const store = getRateLimitMap();
  pruneRateLimitMap(store, now);

  const key = `${tier}:${clientId}`;
  let record = store.get(key);

  if (!record) {
    record = { timestamps: [] };
    store.set(key, record);
  }

  // Filter timestamps outside current rolling window
  record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

  const requestCount = record.timestamps.length;
  const resetMs = record.timestamps.length > 0 ? record.timestamps[0] + config.windowMs - now : config.windowMs;
  const resetSeconds = Math.max(1, Math.ceil(resetMs / 1000));

  if (requestCount >= config.maxRequests) {
    return {
      allowed: false,
      limit: config.maxRequests,
      remaining: 0,
      resetMs,
      retryAfterSeconds: resetSeconds,
      headers: {
        "X-RateLimit-Limit": String(config.maxRequests),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(resetSeconds),
      },
    };
  }

  // Record this valid request
  record.timestamps.push(now);
  const remaining = Math.max(0, config.maxRequests - record.timestamps.length);

  return {
    allowed: true,
    limit: config.maxRequests,
    remaining,
    resetMs,
    headers: {
      "X-RateLimit-Limit": String(config.maxRequests),
      "X-RateLimit-Remaining": String(remaining),
      "X-RateLimit-Reset": String(resetSeconds),
    },
  };
}

export function applyRateLimit(request: Request, tier: RateLimitTier = "standard"): Response | null {
  const ip = getClientIp(request);
  const result = checkRateLimit(ip, tier);

  if (!result.allowed) {
    return Response.json(
      {
        error: `Rate limit exceeded. Too many ${tier} requests. Please retry in ${result.retryAfterSeconds} seconds.`,
        code: "RATE_LIMIT_EXCEEDED",
        tier,
        limit: result.limit,
        retryAfter: result.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          ...result.headers,
        },
      }
    );
  }

  return null;
}

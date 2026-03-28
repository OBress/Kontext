// In-memory sliding window rate limiter
// For multi-instance: upgrade to Redis

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < 600_000);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 300_000);

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  repos: { maxRequests: 60, windowMs: 60_000 },
  chat: { maxRequests: 30, windowMs: 60_000 },
  graph: { maxRequests: 20, windowMs: 60_000 },
  prompts: { maxRequests: 10, windowMs: 60_000 },
  ingest: { maxRequests: 5, windowMs: 300_000 },
  team: { maxRequests: 30, windowMs: 60_000 },
  mcp: { maxRequests: 100, windowMs: 60_000 },
  "mcp-keys": { maxRequests: 20, windowMs: 60_000 },
};

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  userId: string,
  routeKey: string,
  config?: RateLimitConfig
): RateLimitResult {
  const cfg = config || RATE_LIMITS[routeKey] || { maxRequests: 60, windowMs: 60_000 };
  const key = `${userId}:${routeKey}`;
  const now = Date.now();
  const windowStart = now - cfg.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside window
  entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

  if (entry.timestamps.length >= cfg.maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    return {
      ok: false,
      remaining: 0,
      resetAt: oldestInWindow + cfg.windowMs,
    };
  }

  entry.timestamps.push(now);
  return {
    ok: true,
    remaining: cfg.maxRequests - entry.timestamps.length,
    resetAt: now + cfg.windowMs,
  };
}

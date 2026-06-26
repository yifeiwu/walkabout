import { NextRequest } from "next/server";

// Lightweight in-memory fixed-window rate limiter.
//
// Note: serverless functions don't share memory across instances, so this is a
// best-effort guard (per warm instance) to avoid a single client hammering the
// shared public OSM services. For strict limits use a shared store (e.g. KV).

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();

// Bound memory on long-lived (warm) instances: drop expired buckets opportunistically
// and, as a hard backstop, evict the oldest entries if the map grows too large.
const MAX_BUCKETS = 10_000;

function prune(now: number): void {
  for (const [key, win] of buckets) {
    if (now >= win.resetAt) buckets.delete(key);
  }
  // If still oversized (e.g. a burst of unique IPs within one window), evict the
  // entries closest to resetting first. Map preserves insertion order.
  if (buckets.size > MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= overflow) break;
    }
  }
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  retryAfter: number; // seconds until window resets
}

// Throttle the (O(n)) sweep so it runs at most this often, not on every request.
let lastPrune = 0;
const PRUNE_INTERVAL_MS = 60_000;

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  if (now - lastPrune > PRUNE_INTERVAL_MS) {
    lastPrune = now;
    prune(now);
  }

  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}

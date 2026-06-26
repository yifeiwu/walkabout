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

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  retryAfter: number; // seconds until window resets
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
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

// Resilient fetch for upstream public OSM services: per-attempt timeout, a
// retry, and (for Overpass) sequential fallback across mirrors within an overall
// time budget.

export const USER_AGENT = "walkabout-map/1.0 (Australian address overlay explorer)";

export const OVERPASS_ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  revalidate?: number;
}

async function fetchWithTimeout(url: string, opts: FetchOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, ...opts.headers },
      signal: controller.signal,
      next: opts.revalidate != null ? { revalidate: opts.revalidate } : undefined,
    });
  } finally {
    clearTimeout(timer);
  }
}

// Single endpoint with one retry on transient failure.
export async function fetchResilient(url: string, opts: FetchOptions = {}): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts);
      // Retry once on rate-limit / gateway errors.
      if (res.status === 429 || res.status === 502 || res.status === 504) {
        lastErr = new Error(`Upstream returned ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("Upstream request failed");
}

export interface OverpassOptions {
  // Max time for any single mirror attempt.
  perAttemptTimeoutMs?: number;
  // Total time budget across all mirror attempts. Sized to stay comfortably
  // within the serverless function's `maxDuration` so the route returns a
  // graceful 502 rather than being killed by the platform.
  overallBudgetMs?: number;
  revalidate?: number;
}

// Fisher-Yates shuffle returning a new array (does not mutate the input).
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Try the Overpass mirrors one at a time, falling back to the next on failure,
// non-OK status, or timeout. The order is randomized per request so load is
// spread evenly across the public mirrors rather than always hammering the
// same one first. Unlike racing all mirrors in parallel, this only loads one
// public instance per request (kinder to the shared OSM infrastructure) while
// still tolerating an individual mirror being down or slow. The whole
// operation is bounded by `overallBudgetMs`.
export async function fetchOverpass(
  query: string,
  opts: OverpassOptions = {},
): Promise<Response> {
  const perAttempt = opts.perAttemptTimeoutMs ?? 20_000;
  const budget = opts.overallBudgetMs ?? 45_000;
  const revalidate = opts.revalidate ?? 3600;
  const data = encodeURIComponent(query);
  const start = Date.now();
  let lastErr: unknown;

  for (const endpoint of shuffled(OVERPASS_ENDPOINTS)) {
    const remaining = budget - (Date.now() - start);
    if (remaining <= 0) break;
    // Never wait longer than the remaining budget for this attempt.
    const timeoutMs = Math.min(perAttempt, remaining);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}?data=${data}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
        next: { revalidate },
      });
      // Treat non-OK as a failure so we fall through to the next mirror.
      if (!res.ok) {
        lastErr = new Error(`${endpoint} returned ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr ?? new Error("All Overpass mirrors failed");
}

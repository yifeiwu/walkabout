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
  // If the in-flight mirror hasn't responded within this window, start the next
  // mirror in parallel ("hedging") rather than waiting out the full per-attempt
  // timeout. Cuts tail latency when a mirror is slow but not failing.
  hedgeDelayMs?: number;
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

// Try the Overpass mirrors with *hedging*: start one mirror (order randomized
// per request so load is spread across the public instances), and if it hasn't
// responded within `hedgeDelayMs`, start the next mirror in parallel rather than
// waiting out the full per-attempt timeout. A failing/non-OK mirror triggers the
// next one immediately. The first OK response wins and all other in-flight
// attempts are aborted, so the common (fast) case still loads only one mirror —
// kind to shared OSM infrastructure — while a slow or dead mirror no longer
// blocks the whole request. The operation is bounded by `overallBudgetMs`.
export async function fetchOverpass(
  query: string,
  opts: OverpassOptions = {},
): Promise<Response> {
  const perAttempt = opts.perAttemptTimeoutMs ?? 12_000;
  const budget = opts.overallBudgetMs ?? 45_000;
  const hedgeDelayMs = opts.hedgeDelayMs ?? 3_500;
  const revalidate = opts.revalidate ?? 3600;
  const data = encodeURIComponent(query);
  const endpoints = shuffled(OVERPASS_ENDPOINTS);
  const start = Date.now();
  const remaining = () => budget - (Date.now() - start);

  return new Promise<Response>((resolve, reject) => {
    const controllers = new Set<AbortController>();
    const errors: unknown[] = [];
    let nextIdx = 0;
    let active = 0;
    let settled = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

    const clearHedge = () => {
      if (hedgeTimer) {
        clearTimeout(hedgeTimer);
        hedgeTimer = null;
      }
    };

    const succeed = (res: Response, winner: AbortController) => {
      if (settled) return;
      settled = true;
      clearHedge();
      for (const c of controllers) if (c !== winner) c.abort();
      resolve(res);
    };

    // Reject only once nothing is running, nothing is scheduled, and there are
    // no more mirrors (or budget) left to try.
    const failIfDone = () => {
      if (settled) return;
      if (
        active === 0 &&
        !hedgeTimer &&
        (nextIdx >= endpoints.length || remaining() <= 0)
      ) {
        settled = true;
        reject(errors[errors.length - 1] ?? new Error("All Overpass mirrors failed"));
      }
    };

    const scheduleHedge = () => {
      if (settled || hedgeTimer || nextIdx >= endpoints.length) return;
      const r = remaining();
      if (r <= 0) return;
      hedgeTimer = setTimeout(() => {
        hedgeTimer = null;
        launchNext();
      }, Math.min(hedgeDelayMs, r));
    };

    const launchNext = () => {
      if (settled) return;
      const r = remaining();
      if (nextIdx >= endpoints.length || r <= 0) {
        failIfDone();
        return;
      }
      const endpoint = endpoints[nextIdx++];
      const controller = new AbortController();
      controllers.add(controller);
      active++;
      const timer = setTimeout(() => controller.abort(), Math.min(perAttempt, r));

      // Speculatively hedge to the next mirror if this one is slow.
      scheduleHedge();

      fetch(`${endpoint}?data=${data}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
        next: { revalidate },
      })
        .then((res) => {
          if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
          succeed(res, controller);
        })
        .catch((e) => {
          if (settled) return;
          errors.push(e);
          // This mirror failed — don't wait out the hedge delay, try the next now.
          clearHedge();
          launchNext();
        })
        .finally(() => {
          clearTimeout(timer);
          controllers.delete(controller);
          active--;
          failIfDone();
        });
    };

    launchNext();
  });
}

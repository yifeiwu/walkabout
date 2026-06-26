// Resilient fetch for upstream public OSM services: per-attempt timeout, a
// retry, and (for Overpass) fallback across mirrors.

export const USER_AGENT = "walkabout-map/1.0 (Australian address overlay explorer)";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
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

// Query all Overpass mirrors in parallel and use whichever responds first with
// a usable result. The public instances frequently queue requests behind a
// limited number of slots, so racing them avoids being stuck behind one slow
// mirror. Once a winner is found, the in-flight requests to the others are
// aborted to be polite.
export async function fetchOverpass(query: string, timeoutMs = 30000): Promise<Response> {
  const data = encodeURIComponent(query);
  const controllers = OVERPASS_ENDPOINTS.map(() => new AbortController());

  const racers = OVERPASS_ENDPOINTS.map(async (endpoint, i) => {
    const timer = setTimeout(() => controllers[i].abort(), timeoutMs);
    try {
      const res = await fetch(`${endpoint}?data=${data}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controllers[i].signal,
        next: { revalidate: 3600 },
      });
      // Treat non-OK as a failure so Promise.any can pick a working mirror.
      if (!res.ok) throw new Error(`${endpoint} returned ${res.status}`);
      return { res, index: i };
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    const { res, index } = await Promise.any(racers);
    // Cancel the losing requests; leave the winner's body intact for reading.
    controllers.forEach((c, i) => {
      if (i !== index) c.abort();
    });
    return res;
  } catch {
    throw new Error("All Overpass mirrors failed");
  }
}

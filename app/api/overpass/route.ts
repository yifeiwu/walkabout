import { NextRequest, NextResponse } from "next/server";
import { buildOverpassQuery, classify, SUB_BY_ID } from "@/app/lib/categories";
import type { OverpassResponse, PoiFeature } from "@/app/lib/types";
import { fetchOverpass } from "@/app/lib/upstream";
import { clientIp, rateLimit } from "@/app/lib/rateLimit";
import { DEFAULT_RADIUS } from "@/app/lib/constants";

const MAX_RADIUS = 10000;

// Rough Australian bounding box (incl. Tasmania), used to reject coordinates
// outside the supported region.
const AU_BOUNDS = { minLat: -44, maxLat: -9, minLon: 112, maxLon: 154 };

export const revalidate = 3600;

// Cap the serverless function's wall-clock time. fetchOverpass works within a
// smaller budget (see overallBudgetMs), so the route returns a graceful 502
// before the platform would force-kill it.
export const maxDuration = 60;

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

function nameFor(tags: Record<string, string> | undefined, kind: string): string {
  return tags?.name ?? tags?.["operator"] ?? kind.replace(/_/g, " ");
}

// Perpendicular distance (in degrees) from point p to the infinite line a-b.
// Planar approximation is fine at city scale and for shape-preserving thinning.
function perpLineDist(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
}

// Douglas-Peucker line simplification. Rail/road geometries from Overpass can
// carry hundreds of nearly-collinear points; thinning them server-side shrinks
// the payload and the number of polyline vertices the client has to draw.
// epsilon ~ 0.00005 deg ≈ 5.5 m, well below marker scale.
function simplifyLine(
  pts: [number, number][],
  epsilon = 0.00005,
): [number, number][] {
  const n = pts.length;
  if (n <= 2) return pts;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpLineDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx !== -1) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function kindFor(tags: Record<string, string> | undefined): string {
  if (!tags) return "place";
  return (
    tags.amenity ??
    tags.shop ??
    tags.leisure ??
    tags.railway ??
    tags.public_transport ??
    tags.highway ??
    "place"
  );
}

export async function GET(req: NextRequest) {
  const limit = rateLimit(`overpass:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const sp = req.nextUrl.searchParams;
  const rawLat = parseFloat(sp.get("lat") ?? "");
  const rawLon = parseFloat(sp.get("lon") ?? "");
  const radius = Math.min(
    parseInt(sp.get("radius") ?? `${DEFAULT_RADIUS}`, 10) || DEFAULT_RADIUS,
    MAX_RADIUS,
  );

  // Optional comma-separated subcategory ids: query only what's needed.
  const subsParam = sp.get("subs")?.trim();
  const subIds = subsParam
    ? subsParam.split(",").map((s) => s.trim()).filter((s) => s in SUB_BY_ID)
    : undefined;

  if (subsParam && (!subIds || subIds.length === 0)) {
    return NextResponse.json({ error: "No valid subcategories requested." }, { status: 400 });
  }

  // Snap coordinates to ~3 decimals (~110 m) so nearby searches share cache.
  const lat = Number.isNaN(rawLat) ? rawLat : Math.round(rawLat * 1000) / 1000;
  const lon = Number.isNaN(rawLon) ? rawLon : Math.round(rawLon * 1000) / 1000;

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return NextResponse.json(
      { error: "Missing or invalid 'lat'/'lon' query parameters." },
      { status: 400 },
    );
  }

  if (
    lat < AU_BOUNDS.minLat ||
    lat > AU_BOUNDS.maxLat ||
    lon < AU_BOUNDS.minLon ||
    lon > AU_BOUNDS.maxLon
  ) {
    return NextResponse.json(
      { error: "Location is outside Australia. This app covers Australian cities only." },
      { status: 400 },
    );
  }

  const query = buildOverpassQuery(radius, lat, lon, subIds);

  let res: Response;
  try {
    res = await fetchOverpass(query);
  } catch {
    return NextResponse.json(
      { error: "Could not reach the Overpass (OpenStreetMap) service. Try again shortly." },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { elements: OverpassElement[] };
  const features: PoiFeature[] = [];
  const counts: Record<string, number> = {};
  const truncatedSet = new Set<string>();
  const seen = new Set<string>();

  for (const el of data.elements ?? []) {
    const sub = classify(el.tags);
    if (!sub) continue;

    const currentCount = counts[sub.id] ?? 0;
    if (currentCount >= sub.maxFeatures) {
      truncatedSet.add(sub.id);
      continue;
    }

    const kind = kindFor(el.tags);
    const name = nameFor(el.tags, kind);

    if (sub.render === "line") {
      if (!el.geometry?.length) continue;
      const line = simplifyLine(
        el.geometry.map((g) => [g.lat, g.lon] as [number, number]),
      );
      features.push({
        id: `${el.type}/${el.id}`,
        osmType: el.type,
        osmId: el.id,
        groupId: sub.groupId,
        subId: sub.id,
        name,
        kind,
        lat: line[0][0],
        lon: line[0][1],
        line,
      });
      counts[sub.id] = currentCount + 1;
      continue;
    }

    const point = el.lat != null ? { lat: el.lat, lon: el.lon! } : el.center;
    if (!point) continue;

    // Dedupe node/way duplicates by subcategory + name + rough location.
    const dedupeKey = `${sub.id}:${name}:${point.lat.toFixed(4)}:${point.lon.toFixed(4)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    features.push({
      id: `${el.type}/${el.id}`,
      osmType: el.type,
      osmId: el.id,
      groupId: sub.groupId,
      subId: sub.id,
      name,
      kind,
      lat: point.lat,
      lon: point.lon,
    });
    counts[sub.id] = currentCount + 1;
  }

  const body: OverpassResponse = {
    features,
    truncatedSubs: [...truncatedSet],
  };
  // Cache at the CDN/edge so repeated or nearby (snapped) searches are instant.
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

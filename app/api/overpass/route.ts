import { NextRequest, NextResponse } from "next/server";
import { buildOverpassQuery, classify, SUB_BY_ID } from "@/app/lib/categories";
import type { OverpassResponse, PoiFeature } from "@/app/lib/types";
import { fetchOverpass } from "@/app/lib/upstream";
import { clientIp, rateLimit } from "@/app/lib/rateLimit";

const DEFAULT_RADIUS = 6000;
const MAX_RADIUS = 10000;

// Rough Australian bounding box (incl. Tasmania), used to reject coordinates
// outside the supported region.
const AU_BOUNDS = { minLat: -44, maxLat: -9, minLon: 112, maxLon: 154 };

export const revalidate = 3600;

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
    const cls = classify(el.tags);
    if (!cls) continue;

    const subDef = SUB_BY_ID[cls.subId];
    const currentCount = counts[cls.subId] ?? 0;
    if (subDef && currentCount >= subDef.maxFeatures) {
      truncatedSet.add(cls.subId);
      continue;
    }

    const kind = kindFor(el.tags);
    const name = nameFor(el.tags, kind);

    if (cls.render === "line") {
      if (!el.geometry?.length) continue;
      features.push({
        id: `${el.type}/${el.id}`,
        osmType: el.type,
        osmId: el.id,
        groupId: cls.groupId,
        subId: cls.subId,
        name,
        kind,
        lat: el.geometry[0].lat,
        lon: el.geometry[0].lon,
        line: el.geometry.map((g) => [g.lat, g.lon] as [number, number]),
      });
      counts[cls.subId] = currentCount + 1;
      continue;
    }

    const point = el.lat != null ? { lat: el.lat, lon: el.lon! } : el.center;
    if (!point) continue;

    // Dedupe node/way duplicates by subcategory + name + rough location.
    const dedupeKey = `${cls.subId}:${name}:${point.lat.toFixed(4)}:${point.lon.toFixed(4)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    features.push({
      id: `${el.type}/${el.id}`,
      osmType: el.type,
      osmId: el.id,
      groupId: cls.groupId,
      subId: cls.subId,
      name,
      kind,
      lat: point.lat,
      lon: point.lon,
    });
    counts[cls.subId] = currentCount + 1;
  }

  const body: OverpassResponse = {
    features,
    counts,
    truncatedSubs: [...truncatedSet],
  };
  // Cache at the CDN/edge so repeated or nearby (snapped) searches are instant.
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

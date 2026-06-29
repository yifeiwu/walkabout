import { NextRequest, NextResponse } from "next/server";
import type { GeocodeResult } from "@/app/lib/types";
import { fetchResilient } from "@/app/lib/upstream";
import { clientIp, rateLimit } from "@/app/lib/rateLimit";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export const revalidate = 86400; // cache geocoding results for a day

// Degrees of bbox span above which we treat the result as a broad (likely
// rural/regional) area rather than a city locality.
const BROAD_AREA_DEG = 0.6;

export async function GET(req: NextRequest) {
  const limit = rateLimit(`geocode:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) {
    return NextResponse.json({ error: "Missing 'address' query parameter." }, { status: 400 });
  }

  const params = new URLSearchParams({
    q: address,
    countrycodes: "au",
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
  });

  let res: Response;
  try {
    res = await fetchResilient(`${NOMINATIM_URL}?${params.toString()}`, {
      timeoutMs: 15000,
      headers: { "Accept-Language": "en-AU,en" },
      revalidate,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the geocoding service. Try again shortly." },
      { status: 502 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Geocoding service error (${res.status}).` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    boundingbox?: [string, string, string, string];
  }>;

  if (!data.length) {
    return NextResponse.json(
      { error: "No matching Australian address found." },
      { status: 404 },
    );
  }

  const top = data[0];
  const result: GeocodeResult = {
    center: [parseFloat(top.lat), parseFloat(top.lon)],
    displayName: top.display_name,
  };

  if (top.boundingbox && top.boundingbox.length === 4) {
    const [south, north, west, east] = top.boundingbox.map(parseFloat);
    result.bbox = [south, north, west, east];
    const latSpan = Math.abs(north - south);
    const lonSpan = Math.abs(east - west);
    result.broadArea = latSpan > BROAD_AREA_DEG || lonSpan > BROAD_AREA_DEG;
  }

  // Addresses don't move, so let the CDN/edge serve repeated or shared (e.g.
  // linked) searches without re-hitting the function or Nominatim.
  return NextResponse.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

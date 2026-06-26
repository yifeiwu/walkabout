import { NextRequest, NextResponse } from "next/server";
import type { AutocompleteItem } from "@/app/lib/types";
import { fetchResilient } from "@/app/lib/upstream";
import { clientIp, rateLimit } from "@/app/lib/rateLimit";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export const revalidate = 86400;

export async function GET(req: NextRequest) {
  const limit = rateLimit(`autocomplete:${clientIp(req)}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json([], { status: 200 }); // fail soft for typeahead
  }

  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([] satisfies AutocompleteItem[]);
  }

  const params = new URLSearchParams({
    q,
    countrycodes: "au",
    format: "jsonv2",
    limit: "6",
  });

  let res: Response;
  try {
    res = await fetchResilient(`${NOMINATIM_URL}?${params.toString()}`, {
      timeoutMs: 8000,
      headers: { "Accept-Language": "en-AU,en" },
      revalidate,
    });
  } catch {
    return NextResponse.json([] satisfies AutocompleteItem[]);
  }

  if (!res.ok) return NextResponse.json([] satisfies AutocompleteItem[]);

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  const items: AutocompleteItem[] = data.map((d) => ({
    label: d.display_name,
    center: [parseFloat(d.lat), parseFloat(d.lon)],
  }));

  return NextResponse.json(items);
}

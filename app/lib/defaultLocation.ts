// The default location shown when there's no ?q= in the URL (first visit or a
// plain refresh), plus helpers to seed the feature cache from a pre-generated
// snapshot so the map paints immediately without hitting Overpass.
import { SUBCATEGORIES } from "@/app/lib/categories";
import { DEFAULT_RADIUS } from "@/app/lib/constants";
import { areaKeyFor, featureKey } from "@/app/lib/areaKey";
import type { OverpassResponse, PoiFeature } from "@/app/lib/types";

// Pre-fetched POIs for the default location, served statically from /public so
// they stay out of the JS bundle. Fetched at runtime to paint the default area
// on first load without hitting Overpass; any search for a real address still
// triggers a live API call. Regenerate with:
//   curl 'http://localhost:3000/api/overpass?lat=-35.2809&lon=149.13&radius=500' \
//     -o public/defaultPoiSnapshot.json
export const DEFAULT_SNAPSHOT_URL = "/defaultPoiSnapshot.json";

export interface DefaultLocation {
  q: string;
  center: [number, number];
  displayName: string;
  radius: number;
}

// Centred on Canberra's Civic (city centre) — a dense, well-mapped area that
// shows the overlays off.
export const DEFAULT_SEARCH: DefaultLocation = {
  q: "Canberra, Australian Capital Territory, Australia",
  center: [-35.2809, 149.13],
  displayName: "Canberra, Australian Capital Territory, Australia",
  radius: DEFAULT_RADIUS,
};

// Turn the fetched default-location snapshot into cache/truncation seeds keyed
// exactly like a live fetch would be. Every subcategory gets an entry (an empty
// array when the snapshot has none) so the load effect treats the whole default
// area as already-fetched and never issues a live Overpass request for it.
export function buildDefaultSeed(snapshot: OverpassResponse): {
  cache: Record<string, PoiFeature[]>;
  truncated: Record<string, boolean>;
} {
  const ak = areaKeyFor(DEFAULT_SEARCH.center, DEFAULT_SEARCH.radius);
  const bySub: Record<string, PoiFeature[]> = {};
  for (const f of snapshot.features) (bySub[f.subId] ??= []).push(f);
  const cache: Record<string, PoiFeature[]> = {};
  for (const s of SUBCATEGORIES) cache[featureKey(ak, s.id)] = bySub[s.id] ?? [];
  const truncated: Record<string, boolean> = {};
  for (const id of snapshot.truncatedSubs) truncated[featureKey(ak, id)] = true;
  return { cache, truncated };
}

// Every default-area cache key, one per subcategory. Marked as "requested"
// up-front during bootstrap so the load effect won't fire a live Overpass call
// while the static snapshot is in flight.
export function defaultAreaKeys(): string[] {
  const ak = areaKeyFor(DEFAULT_SEARCH.center, DEFAULT_SEARCH.radius);
  return SUBCATEGORIES.map((s) => featureKey(ak, s.id));
}

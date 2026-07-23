// Cache-key helpers shared by the data engine and the default-location seed.
// A search area is identified by its snapped centre + radius; each subcategory's
// features are then cached under `${areaKey}::${subId}`. Keeping these helpers in
// one place guarantees the seed, the fetch, and the derived selectors all agree
// on the exact key format.

// Key for a snapped search area. Coordinates are rounded to ~3 decimals (~110 m)
// to match the server-side snapping, so nearby searches share a cache bucket.
export function areaKeyFor(center: [number, number], radius: number): string {
  return `${center[0].toFixed(3)},${center[1].toFixed(3)},${radius}`;
}

// Key for one subcategory's features within a given area.
export function featureKey(areaKey: string, subId: string): string {
  return `${areaKey}::${subId}`;
}

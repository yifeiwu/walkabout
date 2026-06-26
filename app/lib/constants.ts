// Search radii (metres) offered in the UI. The API falls back to DEFAULT_RADIUS
// when a request omits `radius`; keeping it a member of RADIUS_OPTIONS means the
// fallback always matches a value the product can actually produce.
export const RADIUS_OPTIONS = [500, 1000, 2000];
export const DEFAULT_RADIUS = 500;

// Human-readable label for a radius in metres (e.g. 500 -> "500 m", 2000 -> "2 km").
export function formatRadius(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${meters / 1000} km`;
}

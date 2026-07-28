// Search radii (metres) offered in the UI segmented control. Kept to a single
// value so the control stays hidden (SearchForm only renders it when there's
// more than one option); radius is instead driven by the `r` URL parameter.
export const RADIUS_OPTIONS = [500];

// Radii (metres) selectable via the `?r=` URL parameter. Deliberately a superset
// of RADIUS_OPTIONS: power users / shared links can request a wider search
// without exposing a UI control. Values outside this set fall back to
// DEFAULT_RADIUS. Must stay within the API's MAX_RADIUS (10 km).
export const URL_RADIUS_OPTIONS = [500, 1000, 5000];

// Fallback radius when a request omits `radius` or the `r` param is invalid.
// A member of both option sets so the fallback is always a producible value.
export const DEFAULT_RADIUS = 500;

// Human-readable label for a radius in metres (e.g. 500 -> "500 m", 2000 -> "2 km").
export function formatRadius(meters: number): string {
  return meters < 1000 ? `${meters} m` : `${meters / 1000} km`;
}

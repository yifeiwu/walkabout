// Search radii (metres) offered in the UI. The API falls back to DEFAULT_RADIUS
// when a request omits `radius`; keeping it a member of RADIUS_OPTIONS means the
// fallback always matches a value the product can actually produce.
export const RADIUS_OPTIONS = [1000, 3000, 5000];
export const DEFAULT_RADIUS = 3000;

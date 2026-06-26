export interface GeocodeResult {
  center: [number, number]; // [lat, lon]
  displayName: string;
  // Nominatim bounding box [south, north, west, east]; used to flag very large
  // (non-city) areas where overlay coverage is less meaningful.
  bbox?: [number, number, number, number];
  broadArea?: boolean;
}

export interface AutocompleteItem {
  label: string;
  center: [number, number];
}

// A single overlay item. Lines carry a `line` polyline; everything else is a point.
export interface PoiFeature {
  id: string; // e.g. "node/123"
  osmType: "node" | "way" | "relation";
  osmId: number;
  groupId: string;
  subId: string;
  name: string;
  kind: string; // human-readable tag value, e.g. "cafe", "library"
  lat: number;
  lon: number;
  line?: [number, number][]; // present for way geometries (e.g. rail lines)
}

export interface OverpassResponse {
  features: PoiFeature[];
  // Counts keyed by subcategory id.
  counts: Record<string, number>;
  // Subcategory ids whose per-category cap was hit.
  truncatedSubs: string[];
}

// Per-area summary derived from the feature cache, consumed by the legend.
export interface AreaData {
  // Feature count per subcategory id.
  counts: Record<string, number>;
  // Subcategory ids that have been fetched for the current area.
  loaded: Set<string>;
  // Subcategory ids currently being fetched for the current area.
  loading: Set<string>;
  // Subcategory ids whose per-category cap was hit for the current area.
  truncated: Set<string>;
}

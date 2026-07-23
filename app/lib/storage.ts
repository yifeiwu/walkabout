// Typed, SSR-safe wrappers around the browser storage the app persists to.
// Every access is guarded (no `window` on the server) and swallows failures
// (private-mode denials, quota exceeded, malformed JSON) so callers never have
// to sprinkle try/catch around storage. Keys are versioned and bumped when a
// payload's shape changes.
import type { PoiFeature } from "@/app/lib/types";

const VISIBILITY_KEY = "walkabout.visibility.v4";
// Per-tab cache of fetched features so a reload (or returning to a recent area)
// is instant and avoids re-hitting Overpass. Bumped if the cache shape changes.
const FEATURE_CACHE_KEY = "walkabout.featureCache.v1";

export interface PersistedCache {
  cache: Record<string, PoiFeature[]>;
  truncated: Record<string, boolean>;
}

// ---- Visibility (localStorage: persists across tabs/sessions) --------------

// Restored visibility overrides, or null if nothing valid is stored. Callers
// merge this onto their defaults so newly-added subcategories keep their default.
export function readVisibility(): Record<string, boolean> | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(VISIBILITY_KEY);
    return saved ? (JSON.parse(saved) as Record<string, boolean>) : null;
  } catch {
    return null;
  }
}

export function writeVisibility(visible: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(VISIBILITY_KEY, JSON.stringify(visible));
  } catch {
    /* ignore */
  }
}

// ---- Feature cache (sessionStorage: per-tab) -------------------------------

export function readFeatureCache(): PersistedCache | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = sessionStorage.getItem(FEATURE_CACHE_KEY);
    return saved ? (JSON.parse(saved) as PersistedCache) : null;
  } catch {
    return null;
  }
}

export function writeFeatureCache(payload: PersistedCache): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(FEATURE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore (e.g. storage quota exceeded) */
  }
}

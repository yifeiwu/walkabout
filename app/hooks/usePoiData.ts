"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SUBCATEGORIES, defaultVisibility } from "@/app/lib/categories";
import { DEFAULT_RADIUS, RADIUS_OPTIONS } from "@/app/lib/constants";
import { areaKeyFor, featureKey } from "@/app/lib/areaKey";
import {
  DEFAULT_SEARCH,
  DEFAULT_SNAPSHOT_URL,
  buildDefaultSeed,
  defaultAreaKeys,
} from "@/app/lib/defaultLocation";
import { readFeatureCache, readVisibility, writeFeatureCache } from "@/app/lib/storage";
import { fetchJson } from "@/app/lib/fetchJson";
import type {
  AreaData,
  GeocodeResult,
  OverpassResponse,
  PoiFeature,
} from "@/app/lib/types";

export interface PoiData {
  address: string;
  setAddress: (value: string) => void;
  radius: number;
  setRadius: (radius: number) => void;
  geocoding: boolean;
  error: string | null;
  geo: GeocodeResult | null;
  // Per-area summary (counts / loaded / loading / truncated) for the legend.
  areaData: AreaData;
  // Features for the current area, grouped by subcategory id (stable arrays
  // straight from the cache so consumers can detect changes by reference).
  featuresBySub: Record<string, PoiFeature[]>;
  runSearch: (query: string, searchRadius: number, pre?: GeocodeResult) => void;
  clearSearch: () => void;
}

// The search + POI-data engine. Owns the geocoded area, the per-subcategory
// feature cache (with session persistence + rehydration), the batched fetch
// state machine, URL sync, and the one-time bootstrap (URL params win, otherwise
// the static default-location snapshot). Takes the current visibility so it can
// fetch exactly the subcategories that are switched on.
export function usePoiData(visible: Record<string, boolean>): PoiData {
  const [address, setAddress] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeocodeResult | null>(null);

  // Per-subcategory feature cache (keyed by `${areaKey}::${subId}`), held in
  // state so the derived legend/map data re-renders when new data arrives.
  // `requestedRef` tracks keys already fetched or in-flight to avoid issuing
  // duplicate upstream requests.
  const [cache, setCache] = useState<Record<string, PoiFeature[]>>({});
  const [truncatedMap, setTruncatedMap] = useState<Record<string, boolean>>({});
  // Keys (`${areaKey}::${subId}`) of subcategories currently being fetched.
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const requestedRef = useRef<Set<string>>(new Set());

  const inflight = useRef<Set<AbortController>>(new Set());
  const didInit = useRef(false);

  const areaKey = geo ? areaKeyFor(geo.center, radius) : null;

  // Fetch any of the requested subcategories not already cached for this area in
  // a single batched request. Because React batches the visibility updates,
  // bulk actions (initial load, "All", a group toggle, radius change) arrive as
  // one many-id request, while flipping a single layer arrives as a one-id
  // request — giving us efficient bulk loads with fine-grained single toggles.
  const loadSubs = useCallback(
    async (center: [number, number], r: number, subIds: string[]) => {
      const ak = areaKeyFor(center, r);
      const missing = subIds.filter((id) => !requestedRef.current.has(featureKey(ak, id)));
      if (missing.length === 0) return;
      for (const id of missing) requestedRef.current.add(featureKey(ak, id));

      const markLoading = (on: boolean) =>
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          for (const id of missing) {
            if (on) next.add(featureKey(ak, id));
            else next.delete(featureKey(ak, id));
          }
          return next;
        });

      const controller = new AbortController();
      inflight.current.add(controller);
      markLoading(true);
      try {
        const [lat, lon] = center;
        const poi = await fetchJson<OverpassResponse>(
          `/api/overpass?lat=${lat}&lon=${lon}&radius=${r}&subs=${missing.join(",")}`,
          controller.signal,
        );
        const bySub: Record<string, PoiFeature[]> = {};
        for (const f of poi.features) (bySub[f.subId] ??= []).push(f);
        setCache((prev) => {
          const next = { ...prev };
          for (const id of missing) next[featureKey(ak, id)] = bySub[id] ?? [];
          return next;
        });
        if (poi.truncatedSubs.length) {
          setTruncatedMap((prev) => {
            const next = { ...prev };
            for (const id of poi.truncatedSubs) next[featureKey(ak, id)] = true;
            return next;
          });
        }
      } catch (e) {
        // Drop the keys so a later effect run can retry this area/subcategory.
        for (const id of missing) requestedRef.current.delete(featureKey(ak, id));
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not load map data.");
      } finally {
        inflight.current.delete(controller);
        markLoading(false);
      }
    },
    [],
  );

  const runSearch = useCallback(
    async (query: string, searchRadius: number, pre?: GeocodeResult) => {
      const q = query.trim();
      if (!q) return;

      // New area: cancel any in-flight category fetches from the previous one.
      for (const c of inflight.current) c.abort();
      inflight.current.clear();
      setLoadingKeys(new Set());

      setError(null);
      setGeocoding(true);
      const controller = new AbortController();
      inflight.current.add(controller);
      try {
        const geocode =
          pre ??
          (await fetchJson<GeocodeResult>(
            `/api/geocode?address=${encodeURIComponent(q)}`,
            controller.signal,
          ));
        setGeo(geocode);
        setRadius(searchRadius);
        setLastQuery(q);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        inflight.current.delete(controller);
        setGeocoding(false);
      }
    },
    [],
  );

  // Whenever the area or visible set changes, ensure visible subs are loaded.
  useEffect(() => {
    if (!geo) return;
    const need = SUBCATEGORIES.filter((s) => visible[s.id]).map((s) => s.id);
    if (need.length) loadSubs(geo.center, radius, need);
  }, [geo, radius, visible, loadSubs]);

  // Keep the URL shareable.
  useEffect(() => {
    if (!geo || !lastQuery) return;
    const url = new URL(window.location.href);
    url.searchParams.set("q", lastQuery);
    url.searchParams.set("r", String(radius));
    window.history.replaceState(null, "", url.toString());
  }, [geo, radius, lastQuery]);

  // Restore cache + run a search (or bootstrap the default location) on first load.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // One-time initialization from browser state (sessionStorage + URL). These
    // setState calls run once on mount and cannot happen during render (there is
    // no window on the server), which is the accepted use of an init effect.
    /* eslint-disable react-hooks/set-state-in-effect */

    // Rehydrate the feature cache so revisiting a recent area paints instantly.
    // Seeding `requestedRef` with the cached keys stops the load effect from
    // re-fetching data we already have.
    const savedCache = readFeatureCache();
    if (savedCache?.cache) {
      setCache(savedCache.cache);
      for (const key of Object.keys(savedCache.cache)) requestedRef.current.add(key);
    }
    if (savedCache?.truncated) setTruncatedMap(savedCache.truncated);

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const r = parseInt(params.get("r") ?? "", 10);
    const useRadius = r && RADIUS_OPTIONS.includes(r) ? r : DEFAULT_RADIUS;

    // 1) URL params win (shareable links). 2) Otherwise fall back to the
    // default location. There is deliberately no "last search" memory — a plain
    // refresh (no ?q=) always lands on the default rather than the previous area.
    if (q) {
      setAddress(q);
      runSearch(q, useRadius);
      return;
    }

    // No ?q= — show the default location. Mark every default-area key as
    // requested up-front so the load effect won't fire a live Overpass call
    // while the snapshot is in flight; then fetch the pre-generated snapshot
    // (served statically from /public) and seed the cache from it. Any
    // already-rehydrated sessionStorage data wins on merge, so a fresher live
    // result from a prior visit is kept. On a fetch failure we unblock those
    // keys and fall back to a live load of the default area.
    const defaultKeys = defaultAreaKeys();
    for (const key of defaultKeys) requestedRef.current.add(key);

    setAddress(DEFAULT_SEARCH.q);
    setRadius(RADIUS_OPTIONS.includes(DEFAULT_SEARCH.radius) ? DEFAULT_SEARCH.radius : DEFAULT_RADIUS);
    // Deliberately leave `lastQuery` empty for the default: this keeps the URL
    // clean (no ?q=), so a refresh has no address to search and lands back on
    // the static default rather than triggering a live call.
    // Set geo directly (no geocode round-trip) so the map mounts immediately.
    setGeo({ center: DEFAULT_SEARCH.center, displayName: DEFAULT_SEARCH.displayName });
    /* eslint-enable react-hooks/set-state-in-effect */

    fetchJson<OverpassResponse>(DEFAULT_SNAPSHOT_URL, new AbortController().signal)
      .then((snapshot) => {
        const seed = buildDefaultSeed(snapshot);
        setCache((prev) => ({ ...seed.cache, ...prev }));
        if (Object.keys(seed.truncated).length) {
          setTruncatedMap((prev) => ({ ...seed.truncated, ...prev }));
        }
      })
      .catch(() => {
        for (const key of defaultKeys) requestedRef.current.delete(key);
        // Fall back to a live load of whatever's switched on (merging any stored
        // overrides onto the defaults, mirroring the restored visibility).
        const initialVisible = { ...defaultVisibility(), ...(readVisibility() ?? {}) };
        const need = SUBCATEGORIES.filter((s) => initialVisible[s.id]).map((s) => s.id);
        if (need.length) loadSubs(DEFAULT_SEARCH.center, DEFAULT_SEARCH.radius, need);
      });
  }, [runSearch, loadSubs]);

  // Persist the feature cache (per tab). Debounced so a burst of category loads
  // serializes once rather than on every incremental update. Quota errors (the
  // cache can grow across many areas) are swallowed.
  useEffect(() => {
    if (Object.keys(cache).length === 0) return;
    const t = setTimeout(() => {
      writeFeatureCache({ cache, truncated: truncatedMap });
    }, 500);
    return () => clearTimeout(t);
  }, [cache, truncatedMap]);

  // ---- Derived per-area data (counts, loaded set, truncation) --------------
  const areaData: AreaData = useMemo(() => {
    const counts: Record<string, number> = {};
    const loaded = new Set<string>();
    const loading = new Set<string>();
    const truncated = new Set<string>();
    if (areaKey) {
      for (const s of SUBCATEGORIES) {
        const key = featureKey(areaKey, s.id);
        const arr = cache[key];
        if (arr) {
          loaded.add(s.id);
          counts[s.id] = arr.length;
          if (truncatedMap[key]) truncated.add(s.id);
        }
        if (loadingKeys.has(key)) loading.add(s.id);
      }
    }
    return { counts, loaded, loading, truncated };
  }, [areaKey, cache, truncatedMap, loadingKeys]);

  // Features loaded for the current area, grouped by subcategory id. Passing the
  // already-grouped structure lets the map skip a flatten+regroup, and because
  // each value is the stable array straight from `cache`, the map can detect
  // which subcategories changed by reference (no per-feature signature work).
  // Visibility is applied inside the map component so toggling a layer doesn't
  // rebuild the feature set.
  const featuresBySub = useMemo(() => {
    const out: Record<string, PoiFeature[]> = {};
    if (!areaKey) return out;
    for (const s of SUBCATEGORIES) {
      const arr = cache[featureKey(areaKey, s.id)];
      if (arr && arr.length) out[s.id] = arr;
    }
    return out;
  }, [areaKey, cache]);

  // Clearing the address resets the search to a clean state: drop the shareable
  // query params and the remembered query so the URL no longer carries the
  // previous (or default) location. The map keeps showing the last result.
  const clearSearch = useCallback(() => {
    setLastQuery("");
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("r");
    window.history.replaceState(null, "", url.toString());
  }, []);

  return {
    address,
    setAddress,
    radius,
    setRadius,
    geocoding,
    error,
    geo,
    areaData,
    featuresBySub,
    runSearch,
    clearSearch,
  };
}

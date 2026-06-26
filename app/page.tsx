"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { GROUPS, SUBCATEGORIES, defaultVisibility } from "@/app/lib/categories";
import { DEFAULT_RADIUS, RADIUS_OPTIONS, formatRadius } from "@/app/lib/constants";
import { fetchJson } from "@/app/lib/fetchJson";
import type {
  AreaData,
  GeocodeResult,
  OverpassResponse,
  PoiFeature,
} from "@/app/lib/types";
import SearchForm from "@/app/components/SearchForm";
import Legend from "@/app/components/Legend";
import LegendSkeleton from "@/app/components/LegendSkeleton";
import styles from "./page.module.css";

const PostcodeMap = dynamic(() => import("@/app/components/PostcodeMap"), {
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder}>Loading map…</div>,
});

const VISIBILITY_KEY = "walkabout.visibility.v3";
const LAST_SEARCH_KEY = "walkabout.lastSearch.v1";

interface SavedSearch {
  q: string;
  center: [number, number];
  displayName: string;
  radius: number;
}

// Shown on the very first visit so the map is populated immediately rather than
// presenting a blank prompt.
const DEFAULT_SEARCH: SavedSearch = {
  q: "Sydney NSW 2000",
  center: [-33.8688, 151.2093],
  displayName: "Sydney NSW, Australia",
  radius: DEFAULT_RADIUS,
};

// Cache key for a subcategory's features at a given snapped area.
function areaKeyFor(center: [number, number], radius: number): string {
  return `${center[0].toFixed(3)},${center[1].toFixed(3)},${radius}`;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [geocoding, setGeocoding] = useState(false);
  const [fetching, setFetching] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(defaultVisibility);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, g.subcategories.some((s) => s.defaultOn)])),
  );

  // Per-subcategory feature cache (keyed by `${areaKey}::${subId}`), held in
  // state so the derived legend/map data re-renders when new data arrives.
  // `requestedRef` tracks keys already fetched or in-flight to avoid issuing
  // duplicate upstream requests.
  const [cache, setCache] = useState<Record<string, PoiFeature[]>>({});
  const [truncatedMap, setTruncatedMap] = useState<Record<string, boolean>>({});
  const requestedRef = useRef<Set<string>>(new Set());

  const inflight = useRef<Set<AbortController>>(new Set());
  const didInit = useRef(false);

  const areaKey = geo ? areaKeyFor(geo.center, radius) : null;

  // Fetch any of the requested subcategories not already cached for this area.
  const loadSubs = useCallback(
    async (center: [number, number], r: number, subIds: string[]) => {
      const ak = areaKeyFor(center, r);
      const missing = subIds.filter((id) => !requestedRef.current.has(`${ak}::${id}`));
      if (missing.length === 0) return;
      for (const id of missing) requestedRef.current.add(`${ak}::${id}`);

      const controller = new AbortController();
      inflight.current.add(controller);
      setFetching((f) => f + 1);
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
          for (const id of missing) next[`${ak}::${id}`] = bySub[id] ?? [];
          return next;
        });
        if (poi.truncatedSubs.length) {
          setTruncatedMap((prev) => {
            const next = { ...prev };
            for (const id of poi.truncatedSubs) next[`${ak}::${id}`] = true;
            return next;
          });
        }
      } catch (e) {
        // Drop the keys so a later effect run can retry this area/subcategory.
        for (const id of missing) requestedRef.current.delete(`${ak}::${id}`);
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Could not load map data.");
      } finally {
        inflight.current.delete(controller);
        setFetching((f) => Math.max(0, f - 1));
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

  // Restore visibility + run a search from the URL on first load.
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // One-time initialization from browser state (localStorage + URL). These
    // setState calls run once on mount and cannot happen during render (there is
    // no window on the server), which is the accepted use of an init effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const saved = localStorage.getItem(VISIBILITY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        setVisible((v) => ({ ...v, ...parsed }));
      }
    } catch {
      /* ignore */
    }

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    const r = parseInt(params.get("r") ?? "", 10);
    const useRadius = r && RADIUS_OPTIONS.includes(r) ? r : DEFAULT_RADIUS;

    // 1) URL params win (shareable links). 2) Otherwise restore the last
    // search. 3) Otherwise default to a city so the first paint is populated.
    if (q) {
      setAddress(q);
      runSearch(q, useRadius);
      return;
    }

    let restored: SavedSearch | null = null;
    try {
      const saved = localStorage.getItem(LAST_SEARCH_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as SavedSearch;
        if (Array.isArray(parsed.center) && parsed.center.length === 2 && parsed.q) {
          restored = parsed;
        }
      }
    } catch {
      /* ignore */
    }

    const initial = restored ?? DEFAULT_SEARCH;
    setAddress(initial.q);
    setRadius(RADIUS_OPTIONS.includes(initial.radius) ? initial.radius : DEFAULT_RADIUS);
    setLastQuery(initial.q);
    // Set geo directly (no geocode round-trip) so the map mounts immediately.
    setGeo({ center: initial.center, displayName: initial.displayName });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [runSearch]);

  // Persist the last successful search so returning visitors land back here.
  useEffect(() => {
    if (!geo || !lastQuery) return;
    try {
      const payload: SavedSearch = {
        q: lastQuery,
        center: geo.center,
        displayName: geo.displayName,
        radius,
      };
      localStorage.setItem(LAST_SEARCH_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [geo, radius, lastQuery]);

  // Persist visibility.
  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  // ---- Derived per-area data (counts, loaded set, truncation) --------------
  const areaData: AreaData = useMemo(() => {
    const counts: Record<string, number> = {};
    const loaded = new Set<string>();
    const truncated = new Set<string>();
    if (areaKey) {
      for (const s of SUBCATEGORIES) {
        const key = `${areaKey}::${s.id}`;
        const arr = cache[key];
        if (arr) {
          loaded.add(s.id);
          counts[s.id] = arr.length;
          if (truncatedMap[key]) truncated.add(s.id);
        }
      }
    }
    return { counts, loaded, truncated };
  }, [areaKey, cache, truncatedMap]);

  // All features loaded for the current area. Visibility is applied inside the
  // map component (so toggling a layer no longer rebuilds the feature set).
  const features = useMemo(() => {
    if (!areaKey) return [] as PoiFeature[];
    const out: PoiFeature[] = [];
    for (const s of SUBCATEGORIES) {
      const arr = cache[`${areaKey}::${s.id}`];
      if (arr) out.push(...arr);
    }
    return out;
  }, [areaKey, cache]);

  const totalFeatures = useMemo(
    () =>
      SUBCATEGORIES.reduce(
        (sum, s) => sum + (visible[s.id] ? areaData.counts[s.id] ?? 0 : 0),
        0,
      ),
    [visible, areaData],
  );

  const busy = geocoding || fetching > 0;
  const showSkeleton = busy && areaData.loaded.size === 0;
  const showLegend = !!geo && areaData.loaded.size > 0;

  // ---- Visibility toggles (loading handled by the effect above) ------------
  function toggleSub(id: string) {
    setVisible((v) => ({ ...v, [id]: !v[id] }));
  }
  function setGroup(groupId: string, on: boolean) {
    const subs = GROUPS.find((g) => g.id === groupId)?.subcategories ?? [];
    setVisible((v) => ({ ...v, ...Object.fromEntries(subs.map((s) => [s.id, on])) }));
  }
  function setAll(on: boolean) {
    setVisible(Object.fromEntries(SUBCATEGORIES.map((s) => [s.id, on])));
  }
  function toggleExpand(groupId: string) {
    setExpanded((e) => ({ ...e, [groupId]: !e[groupId] }));
  }

  // Clearing the address resets the search to a clean state: drop the shareable
  // query params and the remembered query so the URL no longer carries the
  // previous (or default) location. The map keeps showing the last result.
  function clearSearch() {
    setLastQuery("");
    const url = new URL(window.location.href);
    url.searchParams.delete("q");
    url.searchParams.delete("r");
    window.history.replaceState(null, "", url.toString());
  }

  return (
    <main className={styles.main}>
      <aside className={styles.sidebar}>
        <h1 className={styles.title}>Walkabout</h1>
        <p className={styles.subtitle}>
          Enter an address and find what&apos;s in your neighbourhood — everything within{" "}
          {formatRadius(radius)}, from live OpenStreetMap data.
        </p>

        <SearchForm
          value={address}
          onValueChange={setAddress}
          radius={radius}
          onRadiusChange={setRadius}
          onSearch={runSearch}
          onClear={clearSearch}
          geocoding={geocoding}
        />

        {error && <p className={styles.error}>{error}</p>}

        {geo && (
          <p className={styles.located}>
            Centred on <strong>{geo.displayName}</strong>
          </p>
        )}

        {geo?.broadArea && (
          <p className={styles.note}>
            This looks like a large/regional area — overlay coverage is optimised for
            Australian cities.
          </p>
        )}

        {showSkeleton && <LegendSkeleton />}

        {showLegend && (
          <Legend
            visible={visible}
            expanded={expanded}
            areaData={areaData}
            totalFeatures={totalFeatures}
            onToggleSub={toggleSub}
            onSetGroup={setGroup}
            onSetAll={setAll}
            onToggleExpand={toggleExpand}
          />
        )}
      </aside>

      <section className={styles.mapArea}>
        {geo ? (
          <PostcodeMap
            center={geo.center}
            radius={radius}
            features={features}
            visible={visible}
          />
        ) : (
          <div className={styles.empty}>
            <p>Search an address to see the map.</p>
          </div>
        )}
        {busy && (
          <div className={styles.mapLoading}>
            <span className={styles.spinner} aria-hidden />
            <span>Loading map data…</span>
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        Map data &copy; OpenStreetMap contributors. Coverage is best in Australian cities.
      </footer>
    </main>
  );
}

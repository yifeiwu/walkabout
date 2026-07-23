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
import { iconSvg } from "@/app/lib/icons";
import defaultPoiSnapshot from "@/app/lib/defaultPoiSnapshot.json";
import styles from "./page.module.css";

// Pre-fetched POIs for the default location, bundled at build time. Used to
// paint the default area instantly on first load without hitting Overpass; any
// search for a real address still triggers a live API call. Regenerate with:
//   curl 'http://localhost:3000/api/overpass?lat=-35.2809&lon=149.13&radius=500' \
//     -o app/lib/defaultPoiSnapshot.json
const DEFAULT_POI_SNAPSHOT = defaultPoiSnapshot as OverpassResponse;

const PostcodeMap = dynamic(() => import("@/app/components/PostcodeMap"), {
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder}>Loading map…</div>,
});

const VISIBILITY_KEY = "walkabout.visibility.v4";
// Per-tab cache of fetched features so a reload (or returning to a recent area)
// is instant and avoids re-hitting Overpass. Bumped if the cache shape changes.
const FEATURE_CACHE_KEY = "walkabout.featureCache.v1";

interface PersistedCache {
  cache: Record<string, PoiFeature[]>;
  truncated: Record<string, boolean>;
}

interface DefaultLocation {
  q: string;
  center: [number, number];
  displayName: string;
  radius: number;
}

// Shown whenever there's no ?q= in the URL (first visit or a plain refresh) so
// the map is populated immediately rather than presenting a blank prompt.
// Centred on Canberra's Civic (city centre) — a dense, well-mapped area that
// shows the overlays off.
const DEFAULT_SEARCH: DefaultLocation = {
  q: "Canberra, Australian Capital Territory, Australia",
  center: [-35.2809, 149.13],
  displayName: "Canberra, Australian Capital Territory, Australia",
  radius: DEFAULT_RADIUS,
};

// Cache key for a subcategory's features at a given snapped area.
function areaKeyFor(center: [number, number], radius: number): string {
  return `${center[0].toFixed(3)},${center[1].toFixed(3)},${radius}`;
}

// Turn the bundled default-location snapshot into cache/truncation seeds keyed
// exactly like a live fetch would be. Every subcategory gets an entry (an empty
// array when the snapshot has none) so the load effect treats the whole default
// area as already-fetched and never issues a live Overpass request for it.
function buildDefaultSeed(): {
  cache: Record<string, PoiFeature[]>;
  truncated: Record<string, boolean>;
} {
  const ak = areaKeyFor(DEFAULT_SEARCH.center, DEFAULT_SEARCH.radius);
  const bySub: Record<string, PoiFeature[]> = {};
  for (const f of DEFAULT_POI_SNAPSHOT.features) (bySub[f.subId] ??= []).push(f);
  const cache: Record<string, PoiFeature[]> = {};
  for (const s of SUBCATEGORIES) cache[`${ak}::${s.id}`] = bySub[s.id] ?? [];
  const truncated: Record<string, boolean> = {};
  for (const id of DEFAULT_POI_SNAPSHOT.truncatedSubs) truncated[`${ak}::${id}`] = true;
  return { cache, truncated };
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  // Controls the mobile bottom-sheet drawer (no effect on desktop, where the
  // sidebar is always docked). Closed by default so the map is front-and-centre
  // on small screens.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(defaultVisibility);
  // Groups start collapsed so the sidebar stays compact; users expand the
  // categories they care about. Group-level counts are still shown collapsed.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, false])),
  );

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

  // Refs for mobile-drawer focus management (see the effect below).
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const drawerHandleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const areaKey = geo ? areaKeyFor(geo.center, radius) : null;

  // Fetch any of the requested subcategories not already cached for this area in
  // a single batched request. Because React batches the visibility updates,
  // bulk actions (initial load, "All", a group toggle, radius change) arrive as
  // one many-id request, while flipping a single layer arrives as a one-id
  // request — giving us efficient bulk loads with fine-grained single toggles.
  const loadSubs = useCallback(
    async (center: [number, number], r: number, subIds: string[]) => {
      const ak = areaKeyFor(center, r);
      const missing = subIds.filter((id) => !requestedRef.current.has(`${ak}::${id}`));
      if (missing.length === 0) return;
      for (const id of missing) requestedRef.current.add(`${ak}::${id}`);

      const markLoading = (on: boolean) =>
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          for (const id of missing) {
            if (on) next.add(`${ak}::${id}`);
            else next.delete(`${ak}::${id}`);
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

    // Rehydrate the feature cache so revisiting a recent area paints instantly.
    // Seeding `requestedRef` with the cached keys stops the load effect from
    // re-fetching data we already have.
    try {
      const savedCache = sessionStorage.getItem(FEATURE_CACHE_KEY);
      if (savedCache) {
        const parsed = JSON.parse(savedCache) as PersistedCache;
        if (parsed.cache) {
          setCache(parsed.cache);
          for (const key of Object.keys(parsed.cache)) requestedRef.current.add(key);
        }
        if (parsed.truncated) setTruncatedMap(parsed.truncated);
      }
    } catch {
      /* ignore */
    }

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

    // Seed the cache from the bundled snapshot so the default location paints
    // instantly without an Overpass call. Marking every key requested stops the
    // load effect from re-fetching it. Any already-rehydrated sessionStorage
    // data wins on merge, so a fresher live result from a prior visit is kept.
    const seed = buildDefaultSeed();
    setCache((prev) => ({ ...seed.cache, ...prev }));
    if (Object.keys(seed.truncated).length) {
      setTruncatedMap((prev) => ({ ...seed.truncated, ...prev }));
    }
    for (const key of Object.keys(seed.cache)) requestedRef.current.add(key);

    setAddress(DEFAULT_SEARCH.q);
    setRadius(RADIUS_OPTIONS.includes(DEFAULT_SEARCH.radius) ? DEFAULT_SEARCH.radius : DEFAULT_RADIUS);
    // Deliberately leave `lastQuery` empty for the default: this keeps the URL
    // clean (no ?q=), so a refresh has no address to search and lands back on
    // the static default rather than triggering a live call.
    // Set geo directly (no geocode round-trip) so the map mounts immediately.
    setGeo({ center: DEFAULT_SEARCH.center, displayName: DEFAULT_SEARCH.displayName });
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [runSearch]);

  // Persist visibility.
  useEffect(() => {
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(visible));
    } catch {
      /* ignore */
    }
  }, [visible]);

  // Persist the feature cache (per tab). Debounced so a burst of category loads
  // serializes once rather than on every incremental update. Quota errors (the
  // cache can grow across many areas) are swallowed.
  useEffect(() => {
    if (Object.keys(cache).length === 0) return;
    const t = setTimeout(() => {
      try {
        const payload: PersistedCache = { cache, truncated: truncatedMap };
        sessionStorage.setItem(FEATURE_CACHE_KEY, JSON.stringify(payload));
      } catch {
        /* ignore (e.g. storage quota exceeded) */
      }
    }, 500);
    return () => clearTimeout(t);
  }, [cache, truncatedMap]);

  // Mobile drawer accessibility: while the bottom sheet is open, close it on
  // Escape, trap Tab focus inside it, move focus into the sheet on open, and
  // return focus to the toggle button on close. No-ops on desktop, where the
  // toggle is hidden and the drawer never opens.
  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    // Move focus into the sheet so keyboard users start inside it.
    drawerHandleRef.current?.focus();

    // The toggle is stable for the drawer's lifetime, so capture it now for the
    // cleanup (avoids reading a possibly-changed ref during teardown).
    const toggle = drawerToggleRef.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Return focus to the button that opened the drawer.
      toggle?.focus();
    };
  }, [drawerOpen]);

  // ---- Derived per-area data (counts, loaded set, truncation) --------------
  const areaData: AreaData = useMemo(() => {
    const counts: Record<string, number> = {};
    const loaded = new Set<string>();
    const loading = new Set<string>();
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
      const arr = cache[`${areaKey}::${s.id}`];
      if (arr && arr.length) out[s.id] = arr;
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

  const showLegend = !!geo;
  // Keep a map indicator while geocoding a new area or loading any category.
  const mapBusy = geocoding || areaData.loading.size > 0;

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
      {/* Mobile-only: opens the bottom-sheet drawer. Hidden on desktop. */}
      <button
        ref={drawerToggleRef}
        type="button"
        className={styles.drawerToggle}
        onClick={() => setDrawerOpen(true)}
        aria-label="Open search and filters"
        aria-haspopup="dialog"
        aria-expanded={drawerOpen}
      >
        <span
          className={styles.drawerToggleIcon}
          aria-hidden
          dangerouslySetInnerHTML={{ __html: iconSvg("search") }}
        />
        Search &amp; filters
      </button>
      {/* Mobile-only backdrop; tapping it dismisses the drawer. */}
      <div
        className={`${styles.drawerBackdrop} ${drawerOpen ? styles.drawerBackdropVisible : ""}`}
        onClick={() => setDrawerOpen(false)}
        aria-hidden
      />

      <aside
        ref={sidebarRef}
        className={`${styles.sidebar} ${drawerOpen ? styles.sidebarOpen : ""}`}
        role={drawerOpen ? "dialog" : undefined}
        aria-modal={drawerOpen ? true : undefined}
        aria-label={drawerOpen ? "Search and filters" : undefined}
      >
        {/* Mobile-only grab handle to collapse the drawer. Hidden on desktop. */}
        <button
          ref={drawerHandleRef}
          type="button"
          className={styles.drawerHandle}
          onClick={() => setDrawerOpen(false)}
          aria-label="Close search and filters"
        />
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
          onSearch={(q, r, pre) => {
            setDrawerOpen(false);
            runSearch(q, r, pre);
          }}
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
            featuresBySub={featuresBySub}
            visible={visible}
          />
        ) : (
          <div className={styles.empty}>
            <p>Search an address to see the map.</p>
          </div>
        )}
        {mapBusy && (
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { GROUPS, SUBCATEGORIES, defaultVisibility } from "@/app/lib/categories";
import type {
  AutocompleteItem,
  GeocodeResult,
  OverpassResponse,
  PoiFeature,
} from "@/app/lib/types";
import styles from "./page.module.css";

const PostcodeMap = dynamic(() => import("@/app/components/PostcodeMap"), {
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder}>Loading map…</div>,
});

const RADIUS_OPTIONS = [1000, 3000, 5000];
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
  radius: 1000,
};

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error ?? "Request failed.");
  return json as T;
}

// Cache key for a subcategory's features at a given snapped area.
function areaKeyFor(center: [number, number], radius: number): string {
  return `${center[0].toFixed(3)},${center[1].toFixed(3)},${radius}`;
}

export default function Home() {
  const [address, setAddress] = useState("");
  const [lastQuery, setLastQuery] = useState("");
  const [radius, setRadius] = useState(1000);
  const [geocoding, setGeocoding] = useState(false);
  const [fetching, setFetching] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [geo, setGeo] = useState<GeocodeResult | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(defaultVisibility);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(GROUPS.map((g) => [g.id, g.subcategories.some((s) => s.defaultOn)])),
  );

  const [suggestions, setSuggestions] = useState<AutocompleteItem[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  // Per-subcategory feature cache (keyed by `${areaKey}::${subId}`). Kept in a
  // ref for synchronous reads; `cacheVersion` bumps to trigger re-renders.
  const cacheRef = useRef<Record<string, PoiFeature[]>>({});
  const truncRef = useRef<Record<string, boolean>>({});
  const [cacheVersion, setCacheVersion] = useState(0);

  const inflight = useRef<Set<AbortController>>(new Set());
  const acAbort = useRef<AbortController | null>(null);
  const acTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const didInit = useRef(false);

  const areaKey = geo ? areaKeyFor(geo.center, radius) : null;

  // Fetch any of the requested subcategories not already cached for this area.
  const loadSubs = useCallback(
    async (center: [number, number], r: number, subIds: string[]) => {
      const ak = areaKeyFor(center, r);
      const missing = subIds.filter((id) => !(`${ak}::${id}` in cacheRef.current));
      if (missing.length === 0) return;

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
        for (const id of missing) {
          cacheRef.current[`${ak}::${id}`] = bySub[id] ?? [];
          if (poi.truncatedSubs.includes(id)) truncRef.current[`${ak}::${id}`] = true;
        }
        setCacheVersion((v) => v + 1);
      } catch (e) {
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
      setShowSuggestions(false);
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
    const useRadius = r && RADIUS_OPTIONS.includes(r) ? r : 1000;

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
    setRadius(RADIUS_OPTIONS.includes(initial.radius) ? initial.radius : 1000);
    setLastQuery(initial.q);
    // Set geo directly (no geocode round-trip) so the map mounts immediately.
    setGeo({ center: initial.center, displayName: initial.displayName });
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
  const areaData = useMemo(() => {
    const counts: Record<string, number> = {};
    const loaded = new Set<string>();
    const truncated = new Set<string>();
    if (areaKey) {
      for (const s of SUBCATEGORIES) {
        const key = `${areaKey}::${s.id}`;
        const arr = cacheRef.current[key];
        if (arr) {
          loaded.add(s.id);
          counts[s.id] = arr.length;
          if (truncRef.current[key]) truncated.add(s.id);
        }
      }
    }
    return { counts, loaded, truncated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, cacheVersion]);

  const features = useMemo(() => {
    if (!areaKey) return [] as PoiFeature[];
    const out: PoiFeature[] = [];
    for (const s of SUBCATEGORIES) {
      if (!visible[s.id]) continue;
      const arr = cacheRef.current[`${areaKey}::${s.id}`];
      if (arr) out.push(...arr);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey, cacheVersion, visible]);

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

  // ---- Autocomplete --------------------------------------------------------
  function onAddressChange(value: string) {
    setAddress(value);
    setActiveIdx(-1);
    if (acTimer.current) clearTimeout(acTimer.current);
    if (value.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    acTimer.current = setTimeout(async () => {
      acAbort.current?.abort();
      const controller = new AbortController();
      acAbort.current = controller;
      try {
        const items = await fetchJson<AutocompleteItem[]>(
          `/api/autocomplete?q=${encodeURIComponent(value.trim())}`,
          controller.signal,
        );
        setSuggestions(items);
        setShowSuggestions(items.length > 0);
      } catch {
        /* ignore typeahead errors */
      }
    }, 300);
  }

  function selectSuggestion(item: AutocompleteItem) {
    setAddress(item.label);
    setSuggestions([]);
    setShowSuggestions(false);
    runSearch(item.label, radius, { center: item.center, displayName: item.label });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }

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

  return (
    <main className={styles.main}>
      <aside className={styles.sidebar}>
        <h1 className={styles.title}>Walkabout</h1>
        <p className={styles.subtitle}>
          Enter an address and find what&apos;s in your neighbourhood — everything within{" "}
          {(radius / 1000).toFixed(0)}km, from live OpenStreetMap data.
        </p>

        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(address, radius);
          }}
        >
          <div className={styles.topRow}>
            <div className={styles.searchWrap}>
              <input
                className={styles.input}
                type="text"
                placeholder="e.g. 100 George St, Sydney NSW"
                value={address}
                onChange={(e) => onAddressChange(e.target.value)}
                onKeyDown={onKeyDown}
                onFocus={() => suggestions.length && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                aria-label="Australian address"
                autoComplete="off"
              />
              {showSuggestions && (
                <ul className={styles.suggestions}>
                  {suggestions.map((s, i) => (
                    <li
                      key={`${s.label}-${i}`}
                      className={`${styles.suggestion} ${i === activeIdx ? styles.suggestionActive : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectSuggestion(s);
                      }}
                    >
                      {s.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <select
              id="radius"
              className={styles.radiusSelect}
              value={radius}
              onChange={(e) => setRadius(parseInt(e.target.value, 10))}
              aria-label="Search radius"
            >
              {RADIUS_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {(r / 1000).toFixed(0)} km
                </option>
              ))}
            </select>
          </div>
          <button className={styles.button} type="submit" disabled={geocoding}>
            {geocoding ? "Searching…" : "Show map"}
          </button>
        </form>

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
          <div className={styles.legend}>
            <div className={styles.legendHeader}>
              <span>Overlays</span>
              <span className={styles.total}>{totalFeatures} places</span>
            </div>
            <div className={styles.legendActions}>
              <button type="button" onClick={() => setAll(true)}>
                Select all
              </button>
              <button type="button" onClick={() => setAll(false)}>
                None
              </button>
            </div>

            {GROUPS.map((g) => {
              const shownSubs = g.subcategories.filter(
                (s) => visible[s.id] && areaData.loaded.has(s.id),
              );
              const groupCount = shownSubs.reduce(
                (sum, s) => sum + (areaData.counts[s.id] ?? 0),
                0,
              );
              const onCount = g.subcategories.filter((s) => visible[s.id]).length;
              const allOn = onCount === g.subcategories.length;
              return (
                <div key={g.id} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <input
                      type="checkbox"
                      checked={allOn}
                      ref={(el) => {
                        if (el) el.indeterminate = onCount > 0 && !allOn;
                      }}
                      onChange={(e) => setGroup(g.id, e.target.checked)}
                    />
                    <span className={styles.swatch} style={{ background: g.color }} />
                    <button
                      type="button"
                      className={styles.groupLabel}
                      onClick={() => toggleExpand(g.id)}
                    >
                      {g.label}
                      <span className={styles.caret}>{expanded[g.id] ? "▾" : "▸"}</span>
                    </button>
                    <span className={styles.count}>
                      {shownSubs.length > 0 ? (
                        groupCount
                      ) : (
                        <span className={styles.countMuted}>–</span>
                      )}
                    </span>
                  </div>
                  {expanded[g.id] && (
                    <div className={styles.subList}>
                      {g.subcategories.map((s) => (
                        <label key={s.id} className={styles.subRow}>
                          <input
                            type="checkbox"
                            checked={!!visible[s.id]}
                            onChange={() => toggleSub(s.id)}
                          />
                          <span className={styles.subIcon}>{s.icon}</span>
                          <span className={styles.subLabel}>
                            {s.label}
                            {areaData.truncated.has(s.id) && (
                              <span className={styles.capped} title="Capped subset">
                                {" "}
                                (capped)
                              </span>
                            )}
                          </span>
                          <span className={styles.count}>
                            {visible[s.id] && areaData.loaded.has(s.id) ? (
                              areaData.counts[s.id] ?? 0
                            ) : (
                              <span
                                className={styles.countMuted}
                                title="Select to show on the map"
                              >
                                –
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
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

function LegendSkeleton() {
  return (
    <div className={styles.legend} aria-busy="true">
      <div className={styles.legendHeader}>
        <span>Overlays</span>
        <span className={styles.skelPill} />
      </div>
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className={styles.skelRow}>
          <span className={styles.skelBox} />
          <span className={styles.skelLine} />
          <span className={styles.skelCount} />
        </div>
      ))}
    </div>
  );
}

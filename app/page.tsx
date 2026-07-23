"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { SUBCATEGORIES } from "@/app/lib/categories";
import { formatRadius } from "@/app/lib/constants";
import { iconSvg } from "@/app/lib/icons";
import { useLayerState } from "@/app/hooks/useLayerState";
import { usePoiData } from "@/app/hooks/usePoiData";
import { useFocusTrap } from "@/app/hooks/useFocusTrap";
import SearchForm from "@/app/components/SearchForm";
import Legend from "@/app/components/Legend";
import type { PoiFeature } from "@/app/lib/types";
import styles from "./page.module.css";

const PostcodeMap = dynamic(() => import("@/app/components/PostcodeMap"), {
  ssr: false,
  loading: () => <div className={styles.mapPlaceholder}>Loading map…</div>,
});

export default function Home() {
  const layers = useLayerState();
  const data = usePoiData(layers.visible);

  // Controls the mobile bottom-sheet drawer (no effect on desktop, where the
  // sidebar is always docked). Closed by default so the map is front-and-centre
  // on small screens.
  const [drawerOpen, setDrawerOpen] = useState(false);

  // One-shot highlight request for the map (pulse a point). The nonce makes each
  // click a distinct request so clicking the same entry again re-triggers it.
  const [highlight, setHighlight] = useState<{
    lat: number;
    lon: number;
    nonce: number;
  } | null>(null);

  // Refs for mobile-drawer focus management (see useFocusTrap below).
  const drawerToggleRef = useRef<HTMLButtonElement>(null);
  const drawerHandleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Mobile drawer accessibility: while the bottom sheet is open, trap focus,
  // close on Escape, and restore focus on close. No-ops on desktop, where the
  // toggle is hidden and the drawer never opens.
  useFocusTrap({
    active: drawerOpen,
    containerRef: sidebarRef,
    initialFocusRef: drawerHandleRef,
    returnFocusRef: drawerToggleRef,
    onEscape: closeDrawer,
  });

  const { geo, areaData } = data;

  const totalFeatures = useMemo(
    () =>
      SUBCATEGORIES.reduce(
        (sum, s) => sum + (layers.visible[s.id] ? areaData.counts[s.id] ?? 0 : 0),
        0,
      ),
    [layers.visible, areaData],
  );

  const showLegend = !!geo;
  // Keep a map indicator while geocoding a new area or loading any category.
  const mapBusy = data.geocoding || areaData.loading.size > 0;

  // Ask the map to pulse a point. A fresh nonce each time makes repeated clicks
  // on the same entry re-fire the highlight.
  const highlightFeature = useCallback((feature: PoiFeature) => {
    setHighlight({ lat: feature.lat, lon: feature.lon, nonce: Date.now() });
  }, []);

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
        onClick={closeDrawer}
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
          onClick={closeDrawer}
          aria-label="Close search and filters"
        />
        {/* Mobile-only explicit close (X) button. Hidden on desktop. */}
        <button
          type="button"
          className={styles.drawerClose}
          onClick={closeDrawer}
          aria-label="Close search and filters"
        >
          <span
            className={styles.drawerCloseIcon}
            aria-hidden
            dangerouslySetInnerHTML={{ __html: iconSvg("x") }}
          />
        </button>
        <h1 className={styles.title}>Walkabout</h1>
        <p className={styles.subtitle}>
          Enter an address and find what&apos;s in your neighbourhood — everything within{" "}
          {formatRadius(data.radius)}, from live OpenStreetMap data.
        </p>

        <SearchForm
          value={data.address}
          onValueChange={data.setAddress}
          radius={data.radius}
          onRadiusChange={data.setRadius}
          onSearch={(q, r, pre) => {
            setDrawerOpen(false);
            data.runSearch(q, r, pre);
          }}
          onClear={data.clearSearch}
          geocoding={data.geocoding}
        />

        {data.error && <p className={styles.error}>{data.error}</p>}

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

        {showLegend && geo && (
          <Legend
            visible={layers.visible}
            expanded={layers.expanded}
            expandedSubs={layers.expandedSubs}
            areaData={areaData}
            featuresBySub={data.featuresBySub}
            center={geo.center}
            totalFeatures={totalFeatures}
            onToggleSub={layers.toggleSub}
            onSetGroup={layers.setGroup}
            onSetAll={layers.setAll}
            onToggleExpand={layers.toggleExpand}
            onToggleSubExpand={layers.toggleSubExpand}
            onHighlightFeature={highlightFeature}
          />
        )}
      </aside>

      <section className={styles.mapArea}>
        {geo ? (
          <PostcodeMap
            center={geo.center}
            radius={data.radius}
            featuresBySub={data.featuresBySub}
            visible={layers.visible}
            highlight={highlight}
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

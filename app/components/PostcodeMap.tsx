"use client";

import { useCallback, useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { SUB_BY_ID, type FlatSub } from "@/app/lib/categories";
import { iconSvg } from "@/app/lib/icons";
import { haversineMeters, formatDistance } from "@/app/lib/geo";
import type { PoiFeature } from "@/app/lib/types";

// A point marker tagged with its subcategory colour, so a shared (mixed) cluster
// can colour itself by the dominant category among its children.
type PoiMarker = L.Marker & { _poiColor?: string };

// Fallback cluster colour when children somehow carry no colour.
const CLUSTER_NEUTRAL = "#64748b";

// A one-shot request to visually highlight a point. The `nonce` changes on every
// click (even for the same point) so repeated clicks re-trigger the pulse.
export interface HighlightRequest {
  lat: number;
  lon: number;
  nonce: number;
}

interface Props {
  center: [number, number];
  radius: number;
  featuresBySub: Record<string, PoiFeature[]>;
  visible: Record<string, boolean>;
  highlight: HighlightRequest | null;
  // Describes the map for assistive tech (the Leaflet canvas itself is opaque to
  // screen readers). A visually-hidden textual summary lives alongside it in the
  // page for the actual place counts.
  ariaLabel?: string;
}

export default function PostcodeMap({
  center,
  radius,
  featuresBySub,
  visible,
  highlight,
  ariaLabel = "Interactive map of nearby places",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const centerRef = useRef<[number, number]>(center);
  // The transient pulse overlay + its removal timer, so a new highlight can
  // cancel a still-visible previous one.
  const pulseRef = useRef<L.Marker | null>(null);
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single shared cluster group for ALL point subcategories, so markers from
  // different layers decluster against each other (no cross-category overlap).
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  // Per-subcategory built artefacts: point markers live in `markersRef` (added
  // to the shared cluster group), line geometries in `lineLayersRef` (their own
  // layer groups, added straight to the map since polylines aren't clustered).
  // `builtFromRef` tracks the feature array each was built from (rebuild on
  // reference change); `shownRef` tracks which subs are currently displayed.
  const markersRef = useRef<Record<string, L.Marker[]>>({});
  const lineLayersRef = useRef<Record<string, L.LayerGroup>>({});
  const builtFromRef = useRef<Record<string, PoiFeature[]>>({});
  const shownRef = useRef<Set<string>>(new Set());

  // Kept in sync via an effect (not during render) for use inside popup builders.
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Initialise the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true });
    map.setView([-25.27, 133.77], 4);
    // Light, muted basemap (CARTO Positron) so the colourful POI markers and
    // clusters stand out far more than they do over the busy default OSM tiles.
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    mapRef.current = map;

    // One shared cluster group for every point subcategory. Because all markers
    // live here, the plugin merges nearby points across categories into a single
    // cluster and lays them out without overlap. `spiderfyDistanceMultiplier`
    // fans an opened (mixed) cluster's leaves out a little further for clarity.
    const cluster = L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: clusterRadiusForZoom,
      spiderfyOnMaxZoom: true,
      spiderfyDistanceMultiplier: 1.6,
      iconCreateFunction: dominantClusterIcon,
    });
    cluster.addTo(map);
    clusterRef.current = cluster;

    return () => {
      map.remove();
      mapRef.current = null;
      clusterRef.current = null;
      // The built markers/lines belonged to this now-destroyed map, so drop all
      // reconcile bookkeeping. Otherwise a remount (e.g. React StrictMode) would
      // see `shownRef` still "showing" and never re-add markers to the new map.
      markersRef.current = {};
      lineLayersRef.current = {};
      builtFromRef.current = {};
      shownRef.current.clear();
    };
  }, []);

  // Update the search circle and recenter when center/radius change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (circleRef.current) circleRef.current.remove();
    const circle = L.circle(center, {
      radius,
      color: "#111827",
      weight: 2,
      fillOpacity: 0.04,
      dashArray: "6 6",
    }).addTo(map);
    circleRef.current = circle;
    map.invalidateSize();
    map.fitBounds(circle.getBounds(), { padding: [20, 20] });
  }, [center, radius]);

  // Drop a transient pulsing ring at the requested point to highlight it.
  // Deliberately does NOT change the view (no setView/fitBounds) so the map
  // stays put; the overlay is independent of the cluster group, so it works even
  // when the underlying marker is currently clustered.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !highlight) return;

    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
    if (pulseRef.current) pulseRef.current.remove();

    const pulse = L.marker([highlight.lat, highlight.lon], {
      icon: L.divIcon({
        className: "poi-pulse-icon",
        html: '<span class="poi-pulse"></span>',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      }),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1000,
    }).addTo(map);
    pulseRef.current = pulse;

    pulseTimerRef.current = setTimeout(() => {
      pulse.remove();
      if (pulseRef.current === pulse) pulseRef.current = null;
      pulseTimerRef.current = null;
    }, 1600);

    return () => {
      if (pulseTimerRef.current) {
        clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
      pulse.remove();
      if (pulseRef.current === pulse) pulseRef.current = null;
    };
  }, [highlight]);

  // Build the point markers for one subcategory (added to the shared cluster
  // group). Each marker is tagged with its category colour so a mixed cluster
  // can colour itself. Popups read the live centre via `centerRef`.
  const buildMarkers = useCallback((items: PoiFeature[], def: FlatSub): L.Marker[] => {
    const markers: L.Marker[] = [];
    for (const item of items) {
      if (item.line) continue;
      const marker = L.marker([item.lat, item.lon], {
        icon: markerIcon(def.icon, def.color),
      }) as PoiMarker;
      marker._poiColor = def.color;
      marker.bindPopup(() => popupHtml(item, def.label, def.color, centerRef.current));
      markers.push(marker);
    }
    return markers;
  }, []);

  // Build a plain layer group of polylines for a line subcategory (rail/tram
  // lines). Lines aren't clustered, so this is added straight to the map.
  const buildLineLayer = useCallback((items: PoiFeature[], def: FlatSub): L.LayerGroup => {
    const group = L.layerGroup();
    for (const item of items) {
      if (!item.line) continue;
      L.polyline(item.line, { color: def.color, weight: 3, opacity: 0.85 })
        .bindPopup(() => popupHtml(item, def.label, def.color, centerRef.current))
        .addTo(group);
    }
    return group;
  }, []);

  // Reconcile the shared cluster group + line layers with the data + visibility.
  // Artefacts are built lazily and rebuilt only when a subcategory's feature
  // array reference changes; toggling a layer adds/removes its already-built
  // markers from the shared group (bulk add/removeLayers) rather than rebuilding.
  useEffect(() => {
    const map = mapRef.current;
    const cluster = clusterRef.current;
    if (!map || !cluster) return;

    const hide = (subId: string) => {
      if (!shownRef.current.has(subId)) return;
      lineLayersRef.current[subId]?.remove();
      const markers = markersRef.current[subId];
      if (markers) cluster.removeLayers(markers);
      shownRef.current.delete(subId);
    };
    const show = (subId: string) => {
      if (shownRef.current.has(subId)) return;
      lineLayersRef.current[subId]?.addTo(map);
      const markers = markersRef.current[subId];
      if (markers) cluster.addLayers(markers);
      shownRef.current.add(subId);
    };
    const dropBuilt = (subId: string) => {
      delete markersRef.current[subId];
      delete lineLayersRef.current[subId];
      delete builtFromRef.current[subId];
    };

    // Drop subcategories that no longer have any features.
    for (const subId of Object.keys(builtFromRef.current)) {
      if (!featuresBySub[subId]) {
        hide(subId);
        dropBuilt(subId);
      }
    }

    for (const [subId, items] of Object.entries(featuresBySub)) {
      const def = SUB_BY_ID[subId];
      if (!def) continue;

      const shouldShow = !!visible[subId];
      const dataChanged = builtFromRef.current[subId] !== items;

      if (!shouldShow) {
        hide(subId);
        // If the data changed while hidden, drop the stale build so the next
        // show rebuilds from fresh data.
        if (dataChanged) dropBuilt(subId);
        continue;
      }

      if (dataChanged) {
        hide(subId);
        dropBuilt(subId);
        if (def.render === "line") {
          lineLayersRef.current[subId] = buildLineLayer(items, def);
        } else {
          markersRef.current[subId] = buildMarkers(items, def);
        }
        builtFromRef.current[subId] = items;
      }
      show(subId);
    }
  }, [featuresBySub, visible, buildMarkers, buildLineLayer]);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", width: "100%" }}
      role="application"
      aria-label={ariaLabel}
    />
  );
}

// Pixel radius within which markers are merged into a single cluster. The
// plugin calls this once per zoom level: low zoom (zoomed out) gets a large
// radius so far-apart markers collapse together, high zoom gets a small radius
// so individual markers separate out at street level.
function clusterRadiusForZoom(zoom: number): number {
  if (zoom <= 8) return 160;
  if (zoom <= 11) return 120;
  if (zoom <= 13) return 90;
  if (zoom <= 15) return 60;
  if (zoom <= 17) return 40;
  return 24;
}

// `iconKey` is a semantic key (see app/lib/icons.ts) resolved to a Lucide SVG.
// The SVG strokes with `currentColor`, so the white glyph comes from the div's
// `color`, while the group colour fills the circular background.
function markerIcon(iconKey: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "poi-divicon",
    html: `<div class="poi-marker" style="background:${color};color:#fff">${iconSvg(iconKey)}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

// Cluster icon for the shared (mixed-category) group: colour it by the most
// common category among its children, so a cluster reads as its dominant type.
function dominantClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const counts = new Map<string, number>();
  for (const child of cluster.getAllChildMarkers()) {
    const color = (child as PoiMarker)._poiColor ?? CLUSTER_NEUTRAL;
    counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let color = CLUSTER_NEUTRAL;
  let best = -1;
  for (const [c, n] of counts) {
    if (n > best) {
      best = n;
      color = c;
    }
  }
  return clusterIcon(cluster.getChildCount(), color);
}

function clusterIcon(count: number, color: string): L.DivIcon {
  const size = count < 10 ? 32 : count < 100 ? 38 : 46;
  return L.divIcon({
    className: "poi-cluster",
    html: `<div class="poi-cluster-inner" style="background:${color};width:${size}px;height:${size}px">${count}</div>`,
    iconSize: [size, size],
  });
}

function popupHtml(
  item: PoiFeature,
  subLabel: string,
  color: string,
  center: [number, number],
): string {
  const dist = formatDistance(haversineMeters(center, [item.lat, item.lon]));
  const osmUrl = `https://www.openstreetmap.org/${item.osmType}/${item.osmId}`;
  return `
    <div class="poi-popup">
      <strong>${escapeHtml(item.name)}</strong>
      <div class="poi-popup-meta">
        <span class="poi-popup-tag" style="background:${color}">${escapeHtml(subLabel)}</span>
        <span>${escapeHtml(item.kind.replace(/_/g, " "))}</span>
      </div>
      <div class="poi-popup-dist">${dist} from centre</div>
      <a href="${osmUrl}" target="_blank" rel="noopener noreferrer">View on OpenStreetMap &rarr;</a>
    </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

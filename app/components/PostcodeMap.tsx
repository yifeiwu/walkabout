"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import { SUB_BY_ID } from "@/app/lib/categories";
import type { PoiFeature } from "@/app/lib/types";

interface Props {
  center: [number, number];
  radius: number;
  features: PoiFeature[];
  visible: Record<string, boolean>;
}

export default function PostcodeMap({ center, radius, features, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const centerRef = useRef<[number, number]>(center);
  // One Leaflet layer per subcategory id, plus a content signature so we only
  // rebuild the layers whose feature set actually changed.
  const layersRef = useRef<Record<string, L.Layer>>({});
  const sigRef = useRef<Record<string, string>>({});

  // Kept in sync via an effect (not during render) for use inside popup builders.
  useEffect(() => {
    centerRef.current = center;
  }, [center]);

  // Initialise the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, { scrollWheelZoom: true });
    map.setView([-25.27, 133.77], 4);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
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

  // Build/update subcategory layers when the feature set changes. Only the
  // subcategories whose contents changed are rebuilt; unchanged layers are left
  // intact to avoid tearing down and recreating thousands of markers on every
  // data load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const bySub: Record<string, PoiFeature[]> = {};
    for (const f of features) (bySub[f.subId] ??= []).push(f);

    // Drop layers for subcategories that no longer have any features.
    for (const subId of Object.keys(layersRef.current)) {
      if (!(subId in bySub)) {
        layersRef.current[subId].remove();
        delete layersRef.current[subId];
        delete sigRef.current[subId];
      }
    }

    for (const [subId, items] of Object.entries(bySub)) {
      const def = SUB_BY_ID[subId];
      if (!def) continue;

      // Feature ids are unique and arrive in a stable order, so this signature
      // changes only when the underlying data for the subcategory changes.
      const sig = items.map((i) => i.id).join(",");
      if (sigRef.current[subId] === sig && layersRef.current[subId]) continue;

      layersRef.current[subId]?.remove();

      const hasLines = items.some((i) => i.line);
      const group = hasLines
        ? L.layerGroup()
        : L.markerClusterGroup({
            chunkedLoading: true,
            // Cluster much more aggressively when zoomed out, easing off as
            // the user zooms in to street level.
            maxClusterRadius: clusterRadiusForZoom,
            spiderfyOnMaxZoom: true,
            iconCreateFunction: (cluster) => clusterIcon(cluster.getChildCount(), def.color),
          });

      for (const item of items) {
        const popup = () => popupHtml(item, def.label, def.color, centerRef.current);
        if (item.line) {
          L.polyline(item.line, { color: def.color, weight: 3, opacity: 0.85 })
            .bindPopup(popup)
            .addTo(group);
        } else {
          L.marker([item.lat, item.lon], { icon: markerIcon(def.icon, def.color) })
            .bindPopup(popup)
            .addTo(group);
        }
      }

      layersRef.current[subId] = group;
      sigRef.current[subId] = sig;
      if (visible[subId]) group.addTo(map);
    }
  }, [features, visible]);

  // Toggle subcategory layers without rebuilding them.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [subId, layer] of Object.entries(layersRef.current)) {
      const shouldShow = !!visible[subId];
      const isShown = map.hasLayer(layer);
      if (shouldShow && !isShown) layer.addTo(map);
      if (!shouldShow && isShown) layer.remove();
    }
  }, [visible]);

  return <div ref={containerRef} style={{ height: "100%", width: "100%" }} />;
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

function markerIcon(emoji: string, color: string): L.DivIcon {
  return L.divIcon({
    className: "poi-divicon",
    html: `<div class="poi-marker" style="background:${color}">${emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function clusterIcon(count: number, color: string): L.DivIcon {
  const size = count < 10 ? 32 : count < 100 ? 38 : 46;
  return L.divIcon({
    className: "poi-cluster",
    html: `<div class="poi-cluster-inner" style="background:${color};width:${size}px;height:${size}px">${count}</div>`,
    iconSize: [size, size],
  });
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
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

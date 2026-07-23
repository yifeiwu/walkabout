"use client";

import { useMemo } from "react";
import { GROUPS, SUBCATEGORIES } from "@/app/lib/categories";
import { iconSvg } from "@/app/lib/icons";
import { haversineMeters, formatDistance } from "@/app/lib/geo";
import type { AreaData, PoiFeature } from "@/app/lib/types";
import styles from "../page.module.css";

// Upper bound on how many individual entries a subcategory renders at once, so a
// dense layer (hundreds of results) can't flood the sidebar. Nearest are kept.
const MAX_ENTRIES = 200;

interface LegendProps {
  visible: Record<string, boolean>;
  expanded: Record<string, boolean>;
  expandedSubs: Record<string, boolean>;
  areaData: AreaData;
  featuresBySub: Record<string, PoiFeature[]>;
  center: [number, number];
  totalFeatures: number;
  onToggleSub: (id: string) => void;
  onSetGroup: (groupId: string, on: boolean) => void;
  onSetAll: (on: boolean) => void;
  onToggleExpand: (groupId: string) => void;
  onToggleSubExpand: (subId: string) => void;
  onHighlightFeature: (feature: PoiFeature) => void;
}

// Three-level overlay legend: groups expand into subcategories (with live
// counts), and each subcategory expands into its individual fetched entries.
export default function Legend({
  visible,
  expanded,
  expandedSubs,
  areaData,
  featuresBySub,
  center,
  totalFeatures,
  onToggleSub,
  onSetGroup,
  onSetAll,
  onToggleExpand,
  onToggleSubExpand,
  onHighlightFeature,
}: LegendProps) {
  const totalLayers = SUBCATEGORIES.length;
  const activeLayers = SUBCATEGORIES.reduce((n, s) => n + (visible[s.id] ? 1 : 0), 0);
  const allOn = activeLayers === totalLayers;
  const noneOn = activeLayers === 0;

  return (
    <div className={styles.legend}>
      <div className={styles.legendHeader}>
        <span>Overlays</span>
        <span className={styles.total}>{totalFeatures} places</span>
      </div>
      <div className={styles.legendActions}>
        <span className={styles.layerCount} aria-live="polite">
          <strong>{activeLayers}</strong> of {totalLayers} layers on
        </span>
        <div className={styles.legendActionButtons}>
          <button
            type="button"
            onClick={() => onSetAll(true)}
            disabled={allOn}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onSetAll(false)}
            disabled={noneOn}
          >
            None
          </button>
        </div>
      </div>
      <div
        className={styles.layerMeter}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalLayers}
        aria-valuenow={activeLayers}
        aria-label="Active layers"
      >
        <span
          className={styles.layerMeterFill}
          style={{ width: `${totalLayers ? (activeLayers / totalLayers) * 100 : 0}%` }}
        />
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
        const groupLoading = g.subcategories.some((s) => areaData.loading.has(s.id));
        return (
          <div key={g.id} className={styles.group}>
            <div className={styles.groupHeader}>
              <input
                type="checkbox"
                checked={allOn}
                ref={(el) => {
                  if (el) el.indeterminate = onCount > 0 && !allOn;
                }}
                onChange={(e) => onSetGroup(g.id, e.target.checked)}
              />
              <span
                className={styles.swatch}
                style={{ background: g.color }}
                aria-hidden
                dangerouslySetInnerHTML={{ __html: iconSvg(g.icon) }}
              />
              <button
                type="button"
                className={styles.groupLabel}
                onClick={() => onToggleExpand(g.id)}
              >
                {g.label}
                <span className={styles.caret}>{expanded[g.id] ? "▾" : "▸"}</span>
              </button>
              <span className={styles.count}>
                {groupLoading ? (
                  <span className={styles.rowSpinner} aria-label="Loading" />
                ) : shownSubs.length > 0 ? (
                  groupCount
                ) : (
                  <span className={styles.countMuted}>–</span>
                )}
              </span>
            </div>
            {expanded[g.id] && (
              <div className={styles.subList}>
                {g.subcategories.map((s) => {
                  const entries = featuresBySub[s.id];
                  const hasEntries = !!entries && entries.length > 0;
                  const subOpen = hasEntries && !!expandedSubs[s.id];
                  const label = (
                    <>
                      {s.label}
                      {areaData.truncated.has(s.id) && (
                        <span className={styles.capped} title="Capped subset">
                          {" "}
                          (capped)
                        </span>
                      )}
                    </>
                  );
                  return (
                    <div key={s.id} className={styles.subItem}>
                      <div className={styles.subRow}>
                        <input
                          type="checkbox"
                          checked={!!visible[s.id]}
                          onChange={() => onToggleSub(s.id)}
                          aria-label={s.label}
                        />
                        <span
                          className={styles.subIcon}
                          style={{ color: g.color }}
                          aria-hidden
                          dangerouslySetInnerHTML={{ __html: iconSvg(s.icon) }}
                        />
                        {hasEntries ? (
                          <button
                            type="button"
                            className={styles.subLabelButton}
                            onClick={() => onToggleSubExpand(s.id)}
                            aria-expanded={subOpen}
                          >
                            <span className={styles.subLabel}>{label}</span>
                            <span className={styles.caret}>{subOpen ? "▾" : "▸"}</span>
                          </button>
                        ) : (
                          <span className={styles.subLabel}>{label}</span>
                        )}
                        <span className={styles.count}>
                          {areaData.loading.has(s.id) ? (
                            <span className={styles.rowSpinner} aria-label="Loading" />
                          ) : visible[s.id] && areaData.loaded.has(s.id) ? (
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
                      </div>
                      {subOpen && entries && (
                        <SubEntryList
                          entries={entries}
                          center={center}
                          onHighlight={onHighlightFeature}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// The individual fetched POIs for one subcategory, sorted nearest-first and
// capped. Clicking a row asks the map to pulse that point (no view change).
function SubEntryList({
  entries,
  center,
  onHighlight,
}: {
  entries: PoiFeature[];
  center: [number, number];
  onHighlight: (feature: PoiFeature) => void;
}) {
  const sorted = useMemo(
    () =>
      entries
        .map((f) => ({ f, dist: haversineMeters(center, [f.lat, f.lon]) }))
        .sort((a, b) => a.dist - b.dist),
    [entries, center],
  );
  const shown = sorted.slice(0, MAX_ENTRIES);
  const extra = sorted.length - shown.length;

  return (
    <ul className={styles.entryList}>
      {shown.map(({ f, dist }) => (
        <li key={f.id}>
          <button
            type="button"
            className={styles.entryRow}
            onClick={() => onHighlight(f)}
            title={f.name}
          >
            <span className={styles.entryName}>{f.name}</span>
            <span className={styles.entryDist}>{formatDistance(dist)}</span>
          </button>
        </li>
      ))}
      {extra > 0 && <li className={styles.entryMore}>+{extra} more</li>}
    </ul>
  );
}

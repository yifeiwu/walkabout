"use client";

import { GROUPS, SUBCATEGORIES } from "@/app/lib/categories";
import type { AreaData } from "@/app/lib/types";
import styles from "../page.module.css";

interface LegendProps {
  visible: Record<string, boolean>;
  expanded: Record<string, boolean>;
  areaData: AreaData;
  totalFeatures: number;
  onToggleSub: (id: string) => void;
  onSetGroup: (groupId: string, on: boolean) => void;
  onSetAll: (on: boolean) => void;
  onToggleExpand: (groupId: string) => void;
}

// Two-level overlay legend: groups expand into subcategories with live counts.
export default function Legend({
  visible,
  expanded,
  areaData,
  totalFeatures,
  onToggleSub,
  onSetGroup,
  onSetAll,
  onToggleExpand,
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
              >
                {g.icon}
              </span>
              <button
                type="button"
                className={styles.groupLabel}
                onClick={() => onToggleExpand(g.id)}
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
                      onChange={() => onToggleSub(s.id)}
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
  );
}

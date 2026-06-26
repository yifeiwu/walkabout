import styles from "../page.module.css";

// Placeholder shown while the first batch of overlay data loads.
export default function LegendSkeleton() {
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

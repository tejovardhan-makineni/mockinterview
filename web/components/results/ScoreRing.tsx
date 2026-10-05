import styles from "./ScoreRing.module.css";

export function ScoreRing({
  score,
  assessed = true,
}: {
  score: number;
  assessed?: boolean;
}) {
  const available =
    assessed && Number.isFinite(score) && score >= 0 && score <= 4;
  return (
    <div
      className={styles.ring}
      role="img"
      aria-label={
        available
          ? `Practice score: ${score.toFixed(1)} out of 4`
          : "No score available"
      }
    >
      <svg viewBox="0 0 180 180" aria-hidden="true">
        <circle className={styles.track} cx="90" cy="90" r="76" />
        {available && score > 0 && (
          <circle
            className={styles.value}
            cx="90"
            cy="90"
            r="76"
            pathLength="100"
            strokeDasharray={`${(score / 4) * 100} 100`}
            transform="rotate(-90 90 90)"
          />
        )}
      </svg>
      <div className={styles.label} aria-hidden="true">
        <strong>{available ? score.toFixed(1) : "—"}</strong>
        <span>{available ? "out of 4" : "not scored"}</span>
      </div>
    </div>
  );
}

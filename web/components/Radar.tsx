// Dependency-free SVG radar chart for the report scorecard. Scores are 0..4.
type Point = { label: string; value: number };

// `fill` makes the chart scale to fill its container (used on the dashboard so a
// small 3-axis radar doesn't leave the panel half-empty); otherwise it renders
// at a fixed `size` px (used on the report scorecard).
export function Radar({ data, max = 4, size = 320, fill = false }: { data: Point[]; max?: number; size?: number; fill?: boolean }) {
  const n = data.length;
  if (n < 3) return null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 54;
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;

  const ring = (frac: number) =>
    data.map((_, i) => `${cx + r * frac * Math.cos(angle(i))},${cy + r * frac * Math.sin(angle(i))}`).join(" ");

  const shape = data
    .map((d, i) => {
      const v = Math.max(0, Math.min(max, d.value)) / max;
      return `${cx + r * v * Math.cos(angle(i))},${cy + r * v * Math.sin(angle(i))}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
      className={fill ? "h-full w-full" : undefined}
      style={fill ? { maxHeight: "100%" } : { maxWidth: size }}
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--color-line)" strokeWidth={1} />
      ))}
      {data.map((_, i) => (
        <line key={i} x1={cx} y1={cy} x2={cx + r * Math.cos(angle(i))} y2={cy + r * Math.sin(angle(i))} stroke="var(--color-line)" strokeWidth={1} />
      ))}
      <polygon points={shape} fill="color-mix(in srgb, var(--color-accent) 28%, transparent)" stroke="var(--color-accent)" strokeWidth={2} />
      {data.map((d, i) => {
        const lx = cx + (r + 24) * Math.cos(angle(i));
        const ly = cy + (r + 24) * Math.sin(angle(i));
        return (
          <text key={i} x={lx} y={ly} fontSize={10} fill="var(--color-muted)" textAnchor="middle" dominantBaseline="middle">
            {d.label.length > 14 ? d.label.slice(0, 13) + "…" : d.label}
          </text>
        );
      })}
    </svg>
  );
}

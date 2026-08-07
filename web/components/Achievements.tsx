// Achievements — the gamification surface. The streak is a compact pill for the
// dashboard header (StreakPill); the badges are a single horizontally-scrollable
// strip so they never lengthen the page. Hovering a badge explains what it is
// and, if still locked, how to unlock it. Logic lives in lib/features/achievements.
import type { Badge, BadgeTier, StreakInfo } from "@/lib/features/achievements";

// Per-tier medallion gradient + glow. Kept theme-neutral (works on light/dark).
const TIER: Record<BadgeTier, { grad: string; ring: string; glow: string; label: string }> = {
  bronze:   { grad: "linear-gradient(145deg,#e8a06b,#a55a2a)", ring: "#c9743d", glow: "rgba(197,116,61,0.45)",  label: "Bronze" },
  silver:   { grad: "linear-gradient(145deg,#eef2f8,#9aa6bd)", ring: "#b9c2d4", glow: "rgba(185,194,212,0.40)", label: "Silver" },
  gold:     { grad: "linear-gradient(145deg,#ffe08a,#e0a021)", ring: "#f2c14e", glow: "rgba(242,193,78,0.50)",  label: "Gold" },
  platinum: { grad: "linear-gradient(145deg,#a8f0ff,#6f7bff)", ring: "#8fb6ff", glow: "rgba(124,139,255,0.55)", label: "Platinum" },
};

// Compact streak pill for the dashboard header.
export function StreakPill({ streak }: { streak: StreakInfo }) {
  const alive = streak.current > 0;
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm"
      title={alive
        ? `${streak.activeToday ? "Practiced today — keep it going!" : "Practice today to extend your streak."} · Longest: ${streak.longest} ${streak.longest === 1 ? "day" : "days"}`
        : "Take an interview to start a streak."}
      style={{
        borderColor: alive ? "color-mix(in srgb, var(--color-live) 45%, transparent)" : "var(--color-line)",
        background: alive ? "color-mix(in srgb, var(--color-live) 12%, transparent)" : "transparent",
      }}
    >
      <span style={{ filter: alive ? "none" : "grayscale(1) opacity(0.6)" }}>🔥</span>
      <span className="font-bold" style={{ color: alive ? "var(--color-live)" : "var(--color-faint)" }}>{streak.current}</span>
      <span className="text-[var(--color-muted)]">day{streak.current === 1 ? "" : "s"} streak</span>
    </span>
  );
}

export function Achievements({ badges, earnedCount }: { badges: Badge[]; earnedCount: number }) {
  return (
    <div className="mi-panel mt-4 rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">Achievements</h2>
        <span className="text-xs text-[var(--color-faint)]">{earnedCount} / {badges.length} unlocked</span>
      </div>
      {/* One scrollable row — keeps the dashboard short no matter how many badges. */}
      <div className="mi-doc-scroll flex gap-5 overflow-x-auto pb-2">
        {badges.map((b) => <BadgeMedallion key={b.id} badge={b} />)}
      </div>
    </div>
  );
}

function BadgeMedallion({ badge }: { badge: Badge }) {
  const t = TIER[badge.tier];
  const earned = badge.earned;
  // Hover explains the badge and, when locked, exactly how to unlock it.
  const tip = earned
    ? `${badge.name} — ${badge.desc} · Earned (${t.label})`
    : `${badge.name} — ${badge.desc} · How to unlock: ${badge.current}/${badge.target}`;
  return (
    <div className="group flex w-16 shrink-0 flex-col items-center text-center" title={tip}>
      <div
        className="relative grid h-14 w-14 place-items-center rounded-full text-2xl transition-transform duration-200 group-hover:-translate-y-0.5"
        style={earned
          ? { background: t.grad, boxShadow: `0 4px 14px ${t.glow}, inset 0 1px 2px rgba(255,255,255,0.5)`, border: `1px solid ${t.ring}` }
          : { background: "var(--color-panel-2)", border: "1px solid var(--color-line)" }}
      >
        <span style={earned ? { filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))" } : { filter: "grayscale(1)", opacity: 0.45 }}>
          {badge.icon}
        </span>
        {!earned && (
          <span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] text-[9px]">
            🔒
          </span>
        )}
      </div>
      <div className={`mt-2 line-clamp-2 text-[11px] font-semibold leading-tight ${earned ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"}`}>
        {badge.name}
      </div>
      {!earned && (
        <div className="mt-1 w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
            <div className="h-full rounded-full" style={{ width: `${Math.round(badge.pct * 100)}%`, background: t.ring }} />
          </div>
          <div className="mt-0.5 text-[9px] text-[var(--color-faint)]">{badge.current}/{badge.target}</div>
        </div>
      )}
    </div>
  );
}

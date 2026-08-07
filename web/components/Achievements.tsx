// Achievements — the gamification surface: a consistency streak card plus a
// grid of achievement badges. Earned badges render as glossy tier-colored
// medallions with a glow; locked ones are dimmed with a progress bar toward the
// next unlock. Presentational only — logic lives in lib/features/achievements.
import type { Badge, BadgeTier, StreakInfo } from "@/lib/features/achievements";

// Per-tier medallion gradient + glow. Kept theme-neutral (works on light/dark).
const TIER: Record<BadgeTier, { grad: string; ring: string; glow: string; label: string }> = {
  bronze:   { grad: "linear-gradient(145deg,#e8a06b,#a55a2a)", ring: "#c9743d", glow: "rgba(197,116,61,0.45)",  label: "Bronze" },
  silver:   { grad: "linear-gradient(145deg,#eef2f8,#9aa6bd)", ring: "#b9c2d4", glow: "rgba(185,194,212,0.40)", label: "Silver" },
  gold:     { grad: "linear-gradient(145deg,#ffe08a,#e0a021)", ring: "#f2c14e", glow: "rgba(242,193,78,0.50)",  label: "Gold" },
  platinum: { grad: "linear-gradient(145deg,#a8f0ff,#6f7bff)", ring: "#8fb6ff", glow: "rgba(124,139,255,0.55)", label: "Platinum" },
};

export function Achievements({ streak, badges, earnedCount }: { streak: StreakInfo; badges: Badge[]; earnedCount: number }) {
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_2.2fr]">
      <StreakCard streak={streak} />
      <div className="mi-panel rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold">Achievements</h2>
          <span className="text-xs text-[var(--color-faint)]">{earnedCount} / {badges.length} unlocked</span>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 lg:grid-cols-5">
          {badges.map((b) => <BadgeMedallion key={b.id} badge={b} />)}
        </div>
      </div>
    </div>
  );
}

function StreakCard({ streak }: { streak: StreakInfo }) {
  const alive = streak.current > 0;
  return (
    <div
      className="mi-panel relative overflow-hidden rounded-2xl border border-[var(--color-line)] p-5"
      style={{ background: alive
        ? "linear-gradient(160deg, color-mix(in srgb, var(--color-live) 22%, var(--color-panel)), var(--color-panel))"
        : "var(--color-panel)" }}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-muted)]">
        <span className="text-lg" style={{ filter: alive ? "none" : "grayscale(1) opacity(0.6)" }}>🔥</span>
        Current streak
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tracking-tight" style={{ color: alive ? "var(--color-live)" : "var(--color-faint)" }}>
          {streak.current}
        </span>
        <span className="text-sm text-[var(--color-muted)]">{streak.current === 1 ? "day" : "days"}</span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-faint)]">
        {alive
          ? (streak.activeToday ? "You practiced today — keep it going!" : "Practice today to extend your streak.")
          : "Take an interview to start a streak."}
      </p>
      <div className="mt-3 border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-faint)]">
        Longest streak <span className="font-semibold text-[var(--color-muted)]">{streak.longest} {streak.longest === 1 ? "day" : "days"}</span>
      </div>
    </div>
  );
}

function BadgeMedallion({ badge }: { badge: Badge }) {
  const t = TIER[badge.tier];
  const earned = badge.earned;
  return (
    <div className="group flex flex-col items-center text-center" title={`${badge.name} — ${badge.desc}`}>
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
      <div className={`mt-2 text-[11px] font-semibold leading-tight ${earned ? "text-[var(--color-ink)]" : "text-[var(--color-faint)]"}`}>
        {badge.name}
      </div>
      {earned ? (
        <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide" style={{ color: t.ring }}>{t.label}</div>
      ) : (
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

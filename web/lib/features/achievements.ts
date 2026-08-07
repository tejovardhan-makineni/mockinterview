// Achievements feature slice — turns a user's completed-interview history into
// gamified badges and a consistency streak. Pure and deterministic (a `today`
// param is injectable) so it can be unit-tested and reused across pages.

import type { SessionHistoryItem } from "./interview";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum";

// Per-question metadata the badges need beyond what a session row carries
// (a session has modality but not domain/areas — those come from the catalog).
export interface QuestionMeta {
  domain: string;
  areas: string[];
}

export interface StreakInfo {
  current: number; // consecutive days up to today/yesterday with a completed interview
  longest: number; // best run ever
  lastActive: string | null; // YYYY-MM-DD of the most recent active day
  activeToday: boolean;
}

export interface BadgeDef {
  id: string;
  name: string;
  desc: string; // how it's earned
  icon: string; // emoji
  tier: BadgeTier;
  target: number;
  // current progress value for this badge, given the computed context
  value: (c: AchievementContext) => number;
}

export interface Badge extends BadgeDef {
  current: number;
  earned: boolean;
  pct: number; // 0..1 progress toward target
}

export interface AchievementContext {
  completed: number;
  byModality: Record<string, number>;
  byDomain: Record<string, number>;
  distinctAreas: number;
  bestScore: number;
  strongCount: number; // interviews scored >= 3.0
  streak: StreakInfo;
}

// ---- date helpers ----

// localDay returns a stable YYYY-MM-DD key in the viewer's local timezone.
function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayDiff(a: string, b: string): number {
  // whole-day difference a - b, both YYYY-MM-DD
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const ta = Date.UTC(ay, am - 1, ad);
  const tb = Date.UTC(by, bm - 1, bd);
  return Math.round((ta - tb) / 86_400_000);
}

// computeStreak finds the current and longest run of consecutive calendar days
// that have at least one completed interview. The current streak only counts if
// the latest active day is today or yesterday (else the streak has lapsed).
export function computeStreak(days: string[], today: string): StreakInfo {
  const uniq = Array.from(new Set(days)).sort(); // ascending
  if (uniq.length === 0) return { current: 0, longest: 0, lastActive: null, activeToday: false };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < uniq.length; i++) {
    run = dayDiff(uniq[i], uniq[i - 1]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const last = uniq[uniq.length - 1];
  const gapFromToday = dayDiff(today, last);
  let current = 0;
  if (gapFromToday <= 1) {
    // walk backwards from the last active day counting consecutive days
    current = 1;
    for (let i = uniq.length - 1; i > 0; i--) {
      if (dayDiff(uniq[i], uniq[i - 1]) === 1) current++;
      else break;
    }
  }
  return { current, longest, lastActive: last, activeToday: gapFromToday === 0 };
}

// The badge catalog. Ordered roughly by how a learner unlocks them.
export const BADGES: BadgeDef[] = [
  { id: "first-step", name: "First Step", desc: "Complete your first interview", icon: "🎯", tier: "bronze", target: 1, value: (c) => c.completed },
  { id: "warmed-up", name: "Warmed Up", desc: "Complete 5 interviews", icon: "🔥", tier: "bronze", target: 5, value: (c) => c.completed },
  { id: "committed", name: "Committed", desc: "Complete 10 interviews", icon: "💪", tier: "silver", target: 10, value: (c) => c.completed },
  { id: "grinder", name: "Grinder", desc: "Complete 30 interviews", icon: "⚙️", tier: "gold", target: 30, value: (c) => c.completed },
  { id: "centurion", name: "Centurion", desc: "Complete 100 interviews", icon: "🏆", tier: "platinum", target: 100, value: (c) => c.completed },
  { id: "architect", name: "Architect", desc: "10 system-design interviews", icon: "🧩", tier: "silver", target: 10, value: (c) => c.byModality["system_design"] ?? 0 },
  { id: "code-machine", name: "Code Machine", desc: "10 coding interviews", icon: "⌨️", tier: "silver", target: 10, value: (c) => c.byModality["coding"] ?? 0 },
  { id: "storyteller", name: "Storyteller", desc: "20 behavioral interviews", icon: "🎙️", tier: "gold", target: 20, value: (c) => c.byDomain["behavioral"] ?? 0 },
  { id: "explorer", name: "Explorer", desc: "Interview in 3 different fields", icon: "🧭", tier: "silver", target: 3, value: (c) => c.distinctAreas },
  { id: "on-a-roll", name: "On a Roll", desc: "Practice 3 days in a row", icon: "📅", tier: "bronze", target: 3, value: (c) => c.streak.longest },
  { id: "unstoppable", name: "Unstoppable", desc: "A 7-day practice streak", icon: "⚡", tier: "gold", target: 7, value: (c) => c.streak.longest },
  { id: "iron-will", name: "Iron Will", desc: "A 30-day practice streak", icon: "🗓️", tier: "platinum", target: 30, value: (c) => c.streak.longest },
  { id: "strong-hire", name: "Strong Hire", desc: "Score 3.0+ in an interview", icon: "⭐", tier: "silver", target: 1, value: (c) => c.strongCount },
  { id: "flawless", name: "Flawless", desc: "Score 3.8+ in an interview", icon: "💎", tier: "platinum", target: 1, value: (c) => (c.bestScore >= 3.8 ? 1 : 0) },
];

export interface Achievements {
  streak: StreakInfo;
  badges: Badge[];
  earnedCount: number;
  context: AchievementContext;
}

// computeAchievements is the entry point: given the session history and a
// question-meta lookup, it derives the streak, the badge progress, and totals.
export function computeAchievements(
  sessions: SessionHistoryItem[],
  metaByQid: Record<string, QuestionMeta>,
  today: Date = new Date(),
): Achievements {
  const done = sessions.filter((s) => s.status === "complete");

  const byModality: Record<string, number> = {};
  const byDomain: Record<string, number> = {};
  const areas = new Set<string>();
  let bestScore = 0;
  let strongCount = 0;

  for (const s of done) {
    byModality[s.modality] = (byModality[s.modality] ?? 0) + 1;
    const meta = metaByQid[s.question_id];
    if (meta) {
      byDomain[meta.domain] = (byDomain[meta.domain] ?? 0) + 1;
      for (const a of meta.areas) areas.add(a);
    }
    if (s.scored !== false && typeof s.overall === "number") {
      if (s.overall > bestScore) bestScore = s.overall;
      if (s.overall >= 3) strongCount += 1;
    }
  }

  const streak = computeStreak(done.map((s) => localDay(new Date(s.created_at))), localDay(today));

  const context: AchievementContext = {
    completed: done.length,
    byModality,
    byDomain,
    distinctAreas: areas.size,
    bestScore,
    strongCount,
    streak,
  };

  const badges: Badge[] = BADGES.map((b) => {
    const current = b.value(context);
    return { ...b, current, earned: current >= b.target, pct: Math.max(0, Math.min(1, current / b.target)) };
  });

  return { streak, badges, earnedCount: badges.filter((b) => b.earned).length, context };
}

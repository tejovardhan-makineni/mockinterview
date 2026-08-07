import { describe, it, expect } from "vitest";
import { computeStreak, computeAchievements, type QuestionMeta } from "./achievements";
import type { SessionHistoryItem } from "./interview";

const sess = (over: Partial<SessionHistoryItem>): SessionHistoryItem => ({
  id: Math.random().toString(36).slice(2),
  title: "T", question_id: "q", modality: "system_design", track: "engineering",
  status: "complete", created_at: "2026-08-01T10:00:00Z", ...over,
});

describe("computeStreak", () => {
  it("is zero with no activity", () => {
    expect(computeStreak([], "2026-08-06")).toEqual({ current: 0, longest: 0, lastActive: null, activeToday: false });
  });

  it("counts consecutive days up to today", () => {
    const s = computeStreak(["2026-08-04", "2026-08-05", "2026-08-06"], "2026-08-06");
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
    expect(s.activeToday).toBe(true);
  });

  it("keeps the current streak alive if the last active day was yesterday", () => {
    const s = computeStreak(["2026-08-04", "2026-08-05"], "2026-08-06");
    expect(s.current).toBe(2);
    expect(s.activeToday).toBe(false);
  });

  it("lapses the current streak after a gap but preserves the longest", () => {
    const s = computeStreak(["2026-08-01", "2026-08-02", "2026-08-03"], "2026-08-06");
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3);
  });

  it("dedupes multiple interviews on the same day", () => {
    const s = computeStreak(["2026-08-06", "2026-08-06", "2026-08-05"], "2026-08-06");
    expect(s.current).toBe(2);
  });
});

describe("computeAchievements", () => {
  const meta: Record<string, QuestionMeta> = {
    sd: { domain: "system_design", areas: ["software_engineering"] },
    beh: { domain: "behavioral", areas: ["software_engineering", "medicine"] },
  };
  const today = new Date("2026-08-06T12:00:00Z");

  it("earns the first-step badge after one completed interview", () => {
    const a = computeAchievements([sess({ question_id: "sd" })], meta, today);
    const first = a.badges.find((b) => b.id === "first-step")!;
    expect(first.earned).toBe(true);
    expect(a.earnedCount).toBeGreaterThanOrEqual(1);
  });

  it("ignores non-complete sessions", () => {
    const a = computeAchievements([sess({ status: "active" }), sess({ status: "abandoned" })], meta, today);
    expect(a.context.completed).toBe(0);
    expect(a.badges.find((b) => b.id === "first-step")!.earned).toBe(false);
  });

  it("tracks behavioral-domain progress toward the storyteller badge", () => {
    const rows = Array.from({ length: 4 }, () => sess({ question_id: "beh" }));
    const a = computeAchievements(rows, meta, today);
    const story = a.badges.find((b) => b.id === "storyteller")!;
    expect(story.current).toBe(4);
    expect(story.earned).toBe(false);
    expect(story.pct).toBeCloseTo(0.2);
  });

  it("counts distinct fields for explorer and strong scores", () => {
    const rows = [
      sess({ question_id: "sd", overall: 3.2, scored: true }),
      sess({ question_id: "beh", overall: 3.9, scored: true }),
    ];
    const a = computeAchievements(rows, meta, today);
    expect(a.context.distinctAreas).toBe(2); // software_engineering + medicine
    expect(a.context.strongCount).toBe(2);
    expect(a.badges.find((b) => b.id === "strong-hire")!.earned).toBe(true);
    expect(a.badges.find((b) => b.id === "flawless")!.earned).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import preview from "./features/catalog-preview.json";
import type { QuestionSummary } from "./features/catalog";
import type { Profession } from "./features/profile";
import { buildInterviewShowcase, SHOWCASE_SLIDES } from "./interview-showcase";

const questions = preview.questions as QuestionSummary[];
const professions = preview.professions as Profession[];

describe("interview showcase", () => {
  it("cycles across all available career families before repeating one", () => {
    const representedFamilies = new Set(SHOWCASE_SLIDES.map((s) => s.family));
    expect(
      new Set(
        SHOWCASE_SLIDES.slice(0, representedFamilies.size).map((s) => s.family),
      ).size,
    ).toBe(representedFamilies.size);
    expect(SHOWCASE_SLIDES[0].family).toBe("healthcare");
    expect(SHOWCASE_SLIDES[1].professionKey).toBe("software_engineering");
    expect(SHOWCASE_SLIDES[2].professionKey).toBe("education");
  });

  it("includes every real scenario once without mutating the catalog", () => {
    const before = JSON.stringify({ questions, professions });
    const slides = buildInterviewShowcase(questions, professions);
    expect(slides.map((s) => s.id).sort()).toEqual(
      questions.map((q) => q.id).sort(),
    );
    expect(new Set(slides.map((s) => s.professionKey))).toEqual(
      new Set(questions.map((q) => q.areas[0])),
    );
    expect(JSON.stringify({ questions, professions })).toBe(before);
  });

  it("gives each profession a turn within a family despite unequal counts", () => {
    const engineers = SHOWCASE_SLIDES.filter(
      (s) => s.family === "engineering_trades",
    );
    const roles = new Set(engineers.map((s) => s.professionKey));
    expect(
      new Set(engineers.slice(0, roles.size).map((s) => s.professionKey)).size,
    ).toBe(roles.size);
  });

  it("matches the activity to the interview rather than always showing code", () => {
    const byID = new Map(SHOWCASE_SLIDES.map((s) => [s.id, s]));
    expect(byID.get("lru-cache")?.activity).toBe("Write and test code");
    expect(byID.get("teacher-classroom")?.activity).toBe(
      "Navigate a classroom scenario",
    );
    expect(byID.get("sales-discovery")?.activity).toBe("Lead a discovery call");
    expect(byID.get("law-issue-spotting-contract")?.activity).toBe(
      "Build a written response",
    );
  });

  it("keeps long and future descriptions readable without partial sentences", () => {
    const longQuestion = {
      ...questions[0],
      id: "future-scenario",
      blurb: "A future scenario with many details ".repeat(10),
      format_name: "Case discussion",
    };
    const [slide] = buildInterviewShowcase([longQuestion], professions);
    expect(slide.scenario).toBe(
      "Practice case discussion and explain the reasoning behind your decisions.",
    );
    for (const item of SHOWCASE_SLIDES) {
      expect(item.scenario.length).toBeLessThanOrEqual(180);
      expect(item.scenario).not.toMatch(/…|\.\.\.$/);
    }
  });

  it("projects only public display fields and tolerates an empty catalog", () => {
    const withPrivateFields = {
      ...questions[0],
      reference: { secret: "private-answer" },
      rubric: ["private-rubric"],
      interviewer_instructions: "private-instructions",
    };
    const slides = buildInterviewShowcase([withPrivateFields], professions);
    expect(JSON.stringify(slides)).not.toContain("private-");
    expect(buildInterviewShowcase([], professions)).toEqual([]);
  });
});

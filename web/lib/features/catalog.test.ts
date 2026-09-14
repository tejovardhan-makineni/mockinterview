import { describe, it, expect } from "vitest";
import {
  matchScore,
  filterCatalog,
  MOCK_QUESTIONS,
  catalogMock,
} from "./catalog";
import { MOCK_PROFESSIONS } from "./profile";
import type { QuestionSummary } from "./catalog";

const q: QuestionSummary = {
  id: "url-shortener",
  title: "Design a URL Shortener (TinyURL)",
  track: "engineering",
  domain: "system_design",
  areas: ["software_engineering"],
  modality: "system_design",
  difficulty: "mid",
  tags: ["hashing", "kv-store", "caching"],
  prompt: "Design a service that turns long URLs into short links.",
  blurb: "Read-heavy KV design — hashing, collisions, cache, analytics.",
};

describe("matchScore", () => {
  it("returns 1 for an empty query (show all)", () => {
    expect(matchScore(q, "")).toBe(1);
    expect(matchScore(q, "   ")).toBe(1);
  });

  it("scores a full substring hit highest", () => {
    expect(matchScore(q, "url shortener")).toBe(3);
    expect(matchScore(q, "caching")).toBe(3); // tag substring
  });

  it("scores partial token overlap between 0 and 1", () => {
    const s = matchScore(q, "hashing collisions");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it("returns 0 for a fully unrelated query", () => {
    expect(matchScore(q, "zzzzz qqqqq")).toBe(0);
  });

  it("rewards a 4+ char prefix as a partial match", () => {
    // "colli" shares a 4-char prefix with "collisions" in the blurb.
    expect(matchScore(q, "colli")).toBeGreaterThan(0);
  });
});

describe("catalogMock", () => {
  it("lists the mock questions", async () => {
    expect(await catalogMock.listQuestions()).toEqual(MOCK_QUESTIONS);
  });
  it("falls back to the first question for an unknown id", async () => {
    expect((await catalogMock.getQuestion("nope")).id).toBe(
      MOCK_QUESTIONS[0].id,
    );
  });
});

const registry = [
  {
    key: "software_engineering",
    label: "Software Engineering",
    count: 2,
    tracks: ["engineering"],
    family: "technology",
    family_label: "Technology & Data",
    aliases: ["developer", "SWE"],
    agent: {
      id: "software",
      name: "Software specialist",
      summary: "Probes reliability and architectural tradeoffs.",
    },
  },
  {
    key: "education",
    label: "Education",
    count: 1,
    tracks: ["professional"],
    family: "public_services",
    family_label: "Education & Public Services",
    aliases: ["teacher", "teaching assistant"],
    agent: {
      id: "education",
      name: "Education specialist",
      summary: "Explores inclusive classroom practice.",
    },
  },
];
const technical = {
  ...q,
  format_id: "design-defense",
  format_name: "Design review and defense",
};
const teaching: QuestionSummary = {
  ...q,
  id: "classroom",
  title: "Manage a mixed-ability classroom",
  track: "professional",
  domain: "classroom_management",
  areas: ["education"],
  tags: ["inclusion"],
  blurb: "Respond to different learning needs.",
  prompt: "Talk through an inclusive lesson.",
  modality: "conversational",
  difficulty: "entry",
  format_id: "stakeholder-simulation",
  format_name: "Stakeholder simulation",
};

describe("catalog metadata search", () => {
  it("finds professions by natural names and aliases from the registry", () => {
    expect(matchScore(q, "software engineer", registry)).toBeGreaterThan(0.34);
    expect(matchScore(q, "SWE", registry)).toBeGreaterThan(0.34);
    expect(matchScore(teaching, "teacher", registry)).toBeGreaterThan(0.34);
    expect(matchScore(teaching, "teaching assistant", registry)).toBe(3);
    expect(matchScore(q, "teacher", registry)).toBe(0);
  });
  it("finds format names, career families, and specialist capabilities", () => {
    expect(matchScore(technical, "review and defense", registry)).toBe(3);
    expect(matchScore(q, "Technology & Data", registry)).toBe(3);
    expect(matchScore(q, "reliability", registry)).toBe(3);
    expect(
      matchScore(
        { ...teaching, agent: registry[1].agent },
        "Education specialist",
      ),
    ).toBe(3);
  });
  it("normalizes multiword topic and profession keys", () => {
    expect(matchScore(teaching, "classroom management")).toBe(3);
    expect(matchScore(q, "software engineering")).toBe(3);
  });
  it("does not confuse short job aliases with fragments inside unrelated words", () => {
    expect(
      matchScore(
        { ...q, prompt: "Walk through reliability and quality checks." },
        "HR",
      ),
    ).toBe(0);
    expect(matchScore(q, "IT")).toBe(0);
    expect(matchScore({ ...q, tags: ["HR"] }, "HR")).toBe(3);
  });
  it("ranks a profession's specialist above shared career practice in role searches", () => {
    const career: QuestionSummary = {
      ...q,
      id: "career-story",
      title: "Tell your career story",
      domain: "career_readiness",
      areas: ["career_foundations", "education", "software_engineering"],
      tags: ["transferable-skills"],
      prompt: "Introduce your experience.",
      blurb: "Explain your next step.",
    };
    expect(matchScore(teaching, "teacher", registry)).toBeGreaterThan(
      matchScore(career, "teacher", registry),
    );
    expect(
      filterCatalog([career, teaching], registry, { query: "teacher" }).map(
        (q) => q.id,
      ),
    ).toEqual([teaching.id, career.id]);
    expect(
      filterCatalog([career, technical], registry, {
        query: "software engineering",
      }).map((q) => q.id),
    ).toEqual([technical.id, career.id]);
  });
});

describe("filterCatalog", () => {
  const shared = {
    ...teaching,
    id: "shared",
    areas: ["software_engineering", "education"],
  };
  const bank = [technical, teaching, shared];
  it("includes shared interviews within the appropriate career family", () => {
    expect(
      filterCatalog(bank, registry, { family: "technology" }).map((q) => q.id),
    ).toEqual([technical.id, shared.id]);
    expect(
      filterCatalog(bank, registry, {
        family: "public_services",
        profession: "education",
      }).map((q) => q.id),
    ).toEqual([teaching.id, shared.id]);
  });
  it("keeps interview format, skill topic, and workspace separate", () => {
    expect(
      filterCatalog(bank, registry, {
        format: "stakeholder-simulation",
        topic: "classroom_management",
        workspace: "conversational",
        level: "entry",
      }),
    ).toEqual([teaching, shared]);
    expect(
      filterCatalog(bank, registry, { format: "classroom_management" }),
    ).toEqual([]);
    expect(
      filterCatalog(bank, registry, { topic: "stakeholder-simulation" }),
    ).toEqual([]);
    expect(filterCatalog(bank, registry, { workspace: "written" })).toEqual([]);
  });
  it("prioritizes the selected profession's own scenarios while preserving search relevance", () => {
    const sharedFirst = [shared, teaching, technical];
    expect(
      filterCatalog(sharedFirst, registry, { profession: "education" }).map(
        (q) => q.id,
      ),
    ).toEqual([teaching.id, shared.id]);
    const specificShared = {
      ...shared,
      title: "Exact match for a unique situation",
    };
    expect(
      filterCatalog([teaching, specificShared], registry, {
        profession: "education",
        query: "exact match for a unique situation",
      }),
    ).toEqual([specificShared]);
  });
  it("searches every scenario before pagination and leaves source ordering intact", () => {
    const longBank: QuestionSummary[] = Array.from({ length: 32 }, (_, i) => ({
      ...technical,
      id: `technical-${i}`,
    }));
    longBank.push(teaching);
    expect(filterCatalog(longBank, registry, { query: "teacher" })).toEqual([
      teaching,
    ]);
    expect(longBank[0].id).toBe("technical-0");
    expect(filterCatalog(longBank, registry, {})).toHaveLength(33);
  });
  it("does not report unavailable scenarios in mock profession counts", () => {
    for (const profession of MOCK_PROFESSIONS) {
      expect(profession.count).toBe(
        MOCK_QUESTIONS.filter((q) => q.areas.includes(profession.key)).length,
      );
    }
    expect(
      MOCK_QUESTIONS.every((q) =>
        q.areas.every((area) => MOCK_PROFESSIONS.some((p) => p.key === area)),
      ),
    ).toBe(true);
  });
});

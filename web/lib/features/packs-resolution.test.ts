import { beforeEach, describe, expect, it } from "vitest";
import preview from "./catalog-preview.json";
import { MOCK_QUESTIONS, type QuestionSummary } from "./catalog";
import { interviewMock } from "./interview";
import {
  packsMock,
  resolveMockRound,
  type PackDetail,
  type PackDetailRound,
} from "./packs";
import { DEFAULT_CONFIG } from "./profile";

beforeEach(() => localStorage.clear());
const authoredDefaults = {
  ...DEFAULT_CONFIG,
  target_level: undefined,
  role_track: undefined,
};

describe("bundled practice path resolution", () => {
  it("offers every exported path, including management and new professions, with resolvable rounds", async () => {
    const paths = await packsMock.listPacks();
    expect(paths.map((p) => p.id).sort()).toEqual(
      preview.packs.map((p) => p.id).sort(),
    );
    for (const id of [
      "first-time-manager-practice",
      "engineering-manager-practice",
      "director-leadership-practice",
      "pharmacy-practice",
      "veterinary-practice",
    ]) {
      expect(paths.some((p) => p.id === id)).toBe(true);
    }
    for (const path of paths) {
      const detail = await packsMock.getPack(path.id);
      for (const round of detail.rounds) {
        const question = resolveMockRound(detail, round, MOCK_QUESTIONS);
        expect(question, `${path.id}/${round.id}`).toBeDefined();
        expect(question!.domain).toBe(round.domain);
        expect(question!.modality).toBe(round.modality);
        expect(
          question!.areas.some((area) => detail.areas.includes(area)),
        ).toBe(true);
        if (round.question_id) expect(question!.id).toBe(round.question_id);
        if (round.role_track && question!.role_track)
          expect(question!.role_track).toBe(round.role_track);
      }
    }
  });

  it("starts Amazon behavioral and MBB case rounds with their own domain and profession", async () => {
    for (const [packId, roundId, domain, area] of [
      ["amazon", "intro-behavioral", "behavioral", "software_engineering"],
      ["mbb-consulting", "case-1", "case", "consulting"],
    ]) {
      const path = await packsMock.getPack(packId);
      const round = path.rounds.find((r) => r.id === roundId)!;
      const session = await interviewMock.createSession("", authoredDefaults, {
        packId,
        roundId,
      });
      expect(session.question!.domain).toBe(domain);
      expect(session.question!.areas).toContain(area);
      expect(session.question!.areas[0]).not.toBe("agriculture");
      expect(session.config.target_level).toBe(round.difficulty);
      expect(session.duration_minutes).toBe(round.minutes);
      const eligibleAtLevel = MOCK_QUESTIONS.filter(
        (q) =>
          q.domain === domain &&
          q.modality === round.modality &&
          q.areas.includes(area) &&
          q.difficulty === round.difficulty,
      );
      if (eligibleAtLevel.length)
        expect(session.question!.difficulty).toBe(round.difficulty);
    }
  });

  it("keeps the pinned management scenario and scope through creation and recovery", async () => {
    const path = await packsMock.getPack("engineering-manager-practice");
    const round = path.rounds.find(
      (r) => r.question_id && r.role_track === "management",
    )!;
    expect(round).toBeDefined();
    const session = await packsMock.startRound(
      path.id,
      round.id,
      authoredDefaults,
    );
    const recovered = await interviewMock.getSession(session.id);
    expect(recovered.question_id).toBe(round.question_id);
    expect(recovered.question!.role_track).toBe("management");
    expect(recovered.config.role_track).toBe("management");
    expect(recovered.config.target_level).toBe(round.difficulty);
    expect(recovered.duration_minutes).toBe(round.minutes);
  });

  it("rejects missing paths and rounds instead of substituting another interview", async () => {
    await expect(packsMock.getPack("missing-path")).rejects.toThrow(
      "not found",
    );
    await expect(
      interviewMock.createSession("", authoredDefaults, {
        packId: "amazon",
        roundId: "missing-round",
      }),
    ).rejects.toThrow("not found");
  });
});

describe("role-compatible pooled and pinned selection", () => {
  const round: PackDetailRound = {
    id: "decision",
    title: "Decision",
    kind: "leadership",
    domain: "professional_judgment",
    modality: "conversational",
    difficulty: "manager",
    role_track: "management",
    minutes: 20,
    focus: "Discuss a decision",
  };
  const path: PackDetail = {
    id: "test",
    name: "Test",
    blurb: "",
    areas: ["management"],
    track: "professional",
    rounds: [round],
  };
  const good: QuestionSummary = {
    ...MOCK_QUESTIONS[0],
    id: "z-manager",
    areas: ["management"],
    domain: round.domain,
    modality: round.modality,
    role_track: "management",
    difficulty: "manager",
  };
  const advanced: QuestionSummary = {
    ...good,
    id: "a-director",
    difficulty: "director",
  };
  const bank: QuestionSummary[] = [
    { ...good, id: "wrong-domain", domain: "farming" },
    { ...good, id: "wrong-profession", areas: ["agriculture"] },
    { ...good, id: "wrong-role", role_track: "individual_contributor" },
    advanced,
    good,
  ];
  it("requires compatible scope and prefers the declared level", () => {
    expect(resolveMockRound(path, round, bank)?.id).toBe("z-manager");
    expect(resolveMockRound(path, round, bank.slice(0, 3))).toBeUndefined();
    expect(
      resolveMockRound(path, round, [{ ...good, role_track: undefined }])?.id,
    ).toBe("z-manager");
  });
  it("honors a pinned question even when another candidate matches the level", () => {
    expect(
      resolveMockRound(path, { ...round, question_id: "a-director" }, bank)?.id,
    ).toBe("a-director");
    expect(
      resolveMockRound(path, { ...round, question_id: "missing" }, bank),
    ).toBeUndefined();
    expect(
      resolveMockRound(path, { ...round, question_id: "wrong-role" }, bank),
    ).toBeUndefined();
  });
});

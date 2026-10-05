// Company/goal packs feature slice — curated multi-round interview "loops"
// (e.g. an Amazon on-site) gated by the user's professions, with per-round
// progress and an overall-readiness score. A pack round starts a normal
// interview session carrying pack context (pack_id + round_id); the server
// resolves the round's concrete corpus question. Owns Pack, PackDetail,
// PackProgress. Backend: api/internal/pack (+ data/packs/*.json); routes
// GET /packs, GET /packs/{id}, GET /packs/{id}/progress. Sessions carry
// pack_id / pack_round_id (see features/interview.ts).

import { req } from "../http";
import preview from "./catalog-preview.json";
import type { QuestionSummary } from "./catalog";
import type { InterviewLevel, RoleTrack } from "../roleScope";
import type { Modality } from "../domain";
import type { InterviewConfig } from "./profile";
import { interviewHttp, interviewMock, type Session } from "./interview";

// A round as it appears in a pack SUMMARY (the light list view).
export interface PackRoundSummary {
  id: string;
  title: string;
  kind: string; // free text: behavioral | coding | lld | system_design | bar_raiser | case | ...
  minutes: number;
}

// A pack summary as served by GET /packs.
export interface Pack {
  id: string;
  name: string;
  company?: string;
  blurb: string;
  areas: string[]; // professions this pack is for (= corpus areas); gates visibility
  track: string;
  rounds: PackRoundSummary[];
}

// A round in the FULL pack detail (adds the corpus-resolution fields + focus).
export interface PackDetailRound {
  id: string;
  title: string;
  kind: string;
  domain: string;
  modality: Modality;
  difficulty: InterviewLevel | "";
  role_track?: RoleTrack;
  minutes: number;
  focus: string; // becomes the director's round_focus for the session
  question_id?: string; // authored scenario for a pinned round; absent for pooled rounds
}

// A pack detail as served by GET /packs/{id}.
export interface PackDetail {
  id: string;
  name: string;
  company?: string;
  blurb: string;
  areas: string[];
  track: string;
  rounds: PackDetailRound[];
}

export type PackRoundStatus = "not_started" | "in_progress" | "done";

// Per-round progress: the (light) round header + the session that ran it, if any.
export interface PackProgressRound {
  round: { id: string; title: string; kind: string };
  session_id?: string;
  status: PackRoundStatus;
  overall?: number; // 0..4, present when the round is done + scored
  scored?: boolean;
}

// A pack's progress as served by GET /packs/{id}/progress.
export interface PackProgress {
  pack: Pack;
  rounds: PackProgressRound[];
  overall_readiness: number; // 0..1 — how ready across the whole loop
}

export interface PacksSlice {
  listPacks(profession?: string): Promise<Pack[]>;
  getPack(id: string): Promise<PackDetail>;
  packProgress(id: string): Promise<PackProgress>;
  // Start a pack round = create a session with pack context; the server resolves
  // the round's concrete question. Returns the created Session (carries pack ids).
  startRound(
    packId: string,
    roundId: string,
    cfg: InterviewConfig,
  ): Promise<Session>;
}

export const packsHttp: PacksSlice = {
  listPacks(profession) {
    const qs = profession
      ? `?profession=${encodeURIComponent(profession)}`
      : "";
    return req<Pack[]>(`/api/v1/packs${qs}`);
  },
  getPack(id) {
    return req<PackDetail>(`/api/v1/packs/${id}`);
  },
  packProgress(id) {
    return req<PackProgress>(`/api/v1/packs/${id}/progress`);
  },
  startRound(packId, roundId, cfg) {
    // Reuse the interview slice's session creation so the /sessions contract
    // stays in one place; the pack context rides in the body.
    return interviewHttp.createSession("", cfg, { packId, roundId });
  },
};

// ---- mock ----
// Public paths are exported with the complete safe bank so demo and hosted
// practice resolve the same authored question IDs and scope.
const MOCK_PACK_DETAILS = preview.packs as PackDetail[];

export function resolveMockRound(
  pack: PackDetail,
  round: PackDetailRound,
  questions: readonly QuestionSummary[],
): QuestionSummary | undefined {
  const compatible = (q: QuestionSummary) =>
    q.domain === round.domain &&
    q.modality === round.modality &&
    q.areas.some((area) => pack.areas.includes(area)) &&
    (!round.role_track || !q.role_track || q.role_track === round.role_track);
  if (round.question_id) {
    const pinned = questions.find((q) => q.id === round.question_id);
    return pinned && compatible(pinned) ? pinned : undefined;
  }
  const candidates = questions
    .filter(compatible)
    .sort((a, b) => a.id.localeCompare(b.id));
  return (
    candidates.find((q) => q.difficulty === round.difficulty) ?? candidates[0]
  );
}

const toSummary = (p: PackDetail): Pack => ({
  id: p.id,
  name: p.name,
  company: p.company,
  blurb: p.blurb,
  areas: p.areas,
  track: p.track,
  rounds: p.rounds.map((r) => ({
    id: r.id,
    title: r.title,
    kind: r.kind,
    minutes: r.minutes,
  })),
});

// Mock progress: the first round is done + scored, the rest not started.
function mockProgress(p: PackDetail): PackProgress {
  const rounds: PackProgressRound[] = p.rounds.map((r, i) =>
    i === 0
      ? {
          round: { id: r.id, title: r.title, kind: r.kind },
          session_id: "mock-session",
          status: "done",
          overall: 3.2,
          scored: true,
        }
      : {
          round: { id: r.id, title: r.title, kind: r.kind },
          status: "not_started",
        },
  );
  const done = rounds.filter(
    (r) => r.status === "done" && r.overall !== undefined,
  );
  const readiness = rounds.length
    ? done.reduce((s, r) => s + r.overall! / 5, 0) / rounds.length
    : 0;
  return {
    pack: toSummary(p),
    rounds,
    overall_readiness: Number(readiness.toFixed(2)),
  };
}

export const packsMock: PacksSlice = {
  async listPacks(profession) {
    const all = MOCK_PACK_DETAILS.map(toSummary);
    return profession ? all.filter((p) => p.areas.includes(profession)) : all;
  },
  async getPack(id) {
    const pack = MOCK_PACK_DETAILS.find((p) => p.id === id);
    if (!pack)
      throw new Error("This practice path was not found in the bundled demo.");
    return pack;
  },
  async packProgress(id) {
    return mockProgress(await packsMock.getPack(id));
  },
  startRound(packId, roundId, cfg) {
    return interviewMock.createSession("", cfg, { packId, roundId });
  },
};

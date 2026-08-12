// Company/goal packs feature slice — curated multi-round interview "loops"
// (e.g. an Amazon on-site) gated by the user's professions, with per-round
// progress and an overall-readiness score. A pack round starts a normal
// interview session carrying pack context (pack_id + round_id); the server
// resolves the round's concrete corpus question. Owns Pack, PackDetail,
// PackProgress. Backend: api/internal/pack (+ data/packs/*.json); routes
// GET /packs, GET /packs/{id}, GET /packs/{id}/progress. Sessions carry
// pack_id / pack_round_id (see features/interview.ts).

import { req } from "../http";
import type { Modality } from "../domain";
import type { InterviewConfig } from "./profile";
import { interviewHttp, interviewMock, type Session } from "./interview";

// A round as it appears in a pack SUMMARY (the light list view).
export interface PackRoundSummary {
  id: string;
  title: string;
  kind: string;    // free text: behavioral | coding | lld | system_design | bar_raiser | case | ...
  minutes: number;
}

// A pack summary as served by GET /packs.
export interface Pack {
  id: string;
  name: string;
  company: string;
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
  difficulty: string;
  minutes: number;
  focus: string; // becomes the director's round_focus for the session
}

// A pack detail as served by GET /packs/{id}.
export interface PackDetail {
  id: string;
  name: string;
  company: string;
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
  startRound(packId: string, roundId: string, cfg: InterviewConfig): Promise<Session>;
}

export const packsHttp: PacksSlice = {
  listPacks(profession) {
    const qs = profession ? `?profession=${encodeURIComponent(profession)}` : "";
    return req<Pack[]>(`/api/v1/packs${qs}`);
  },
  getPack(id) { return req<PackDetail>(`/api/v1/packs/${id}`); },
  packProgress(id) { return req<PackProgress>(`/api/v1/packs/${id}/progress`); },
  startRound(packId, roundId, cfg) {
    // Reuse the interview slice's session creation so the /sessions contract
    // stays in one place; the pack context rides in the body.
    return interviewHttp.createSession("", cfg, { packId, roundId });
  },
};

// ---- mock ----
// A few static packs so the /packs page works fully offline (NEXT_PUBLIC_MOCK=1).
// The "amazon" pack mirrors the seed loop from the feature contract.
const MOCK_PACK_DETAILS: PackDetail[] = [
  {
    id: "amazon", name: "Amazon SDE Loop", company: "Amazon",
    blurb: "The full Amazon on-site: Leadership Principles behavioral, two coding rounds, LLD, system design, and a Bar Raiser.",
    areas: ["software_engineering"], track: "engineering",
    rounds: [
      { id: "intro-behavioral", title: "Intro + Behavioral (Leadership Principles)", kind: "behavioral", domain: "behavioral", modality: "conversational", difficulty: "mid", minutes: 45, focus: "Amazon Leadership Principles: probe Ownership, Dive Deep, and Bias for Action with STAR structure and real impact." },
      { id: "coding-1", title: "Coding I", kind: "coding", domain: "coding", modality: "coding", difficulty: "mid", minutes: 45, focus: "Data structures & algorithms: clean, correct code and honest complexity analysis." },
      { id: "coding-2", title: "Coding II", kind: "coding", domain: "coding", modality: "coding", difficulty: "senior", minutes: 45, focus: "A harder algorithmic problem: edge cases, optimization, and testing." },
      { id: "lld", title: "Low-Level Design", kind: "lld", domain: "low_level_design", modality: "system_design", difficulty: "senior", minutes: 45, focus: "Object-oriented design: classes, responsibilities, patterns, and extensibility." },
      { id: "system-design", title: "System Design", kind: "system_design", domain: "system_design", modality: "system_design", difficulty: "senior", minutes: 60, focus: "A scalable distributed system: requirements, tradeoffs, and bottlenecks." },
      { id: "bar-raiser", title: "Bar Raiser", kind: "bar_raiser", domain: "behavioral", modality: "conversational", difficulty: "staff", minutes: 60, focus: "Amazon bar-raiser: raise the bar, probe Leadership Principles depth and consistency." },
    ],
  },
  {
    id: "meta", name: "Meta E5 Loop", company: "Meta",
    blurb: "Behavioral, two coding rounds, and a system design round — the standard Meta software loop.",
    areas: ["software_engineering"], track: "engineering",
    rounds: [
      { id: "behavioral", title: "Behavioral", kind: "behavioral", domain: "behavioral", modality: "conversational", difficulty: "mid", minutes: 45, focus: "Impact, collaboration, and conflict — concrete examples with your individual contribution." },
      { id: "coding-1", title: "Coding I", kind: "coding", domain: "coding", modality: "coding", difficulty: "mid", minutes: 45, focus: "Two medium problems: speed, correctness, and clear communication." },
      { id: "coding-2", title: "Coding II", kind: "coding", domain: "coding", modality: "coding", difficulty: "senior", minutes: 45, focus: "Harder problems under time pressure; talk through tradeoffs." },
      { id: "system-design", title: "System Design", kind: "system_design", domain: "system_design", modality: "system_design", difficulty: "senior", minutes: 45, focus: "Design at scale; drive the conversation and justify choices." },
    ],
  },
  {
    id: "mbb-consulting", name: "MBB Consulting", company: "McKinsey / Bain / BCG",
    blurb: "A PEI (personal experience interview) followed by two case interviews — the classic MBB loop.",
    areas: ["consulting"], track: "professional",
    rounds: [
      { id: "pei", title: "Personal Experience (PEI)", kind: "behavioral", domain: "behavioral", modality: "conversational", difficulty: "mid", minutes: 30, focus: "PEI: leadership, drive, and personal impact — one story, deep." },
      { id: "case-1", title: "Case I", kind: "case", domain: "case", modality: "conversational", difficulty: "senior", minutes: 40, focus: "MECE structure, hypothesis-driven, crisp back-of-envelope math." },
      { id: "case-2", title: "Case II", kind: "case", domain: "case", modality: "conversational", difficulty: "senior", minutes: 40, focus: "A second case with a different shape; synthesize a clear recommendation." },
    ],
  },
];

const toSummary = (p: PackDetail): Pack => ({
  id: p.id, name: p.name, company: p.company, blurb: p.blurb, areas: p.areas, track: p.track,
  rounds: p.rounds.map((r) => ({ id: r.id, title: r.title, kind: r.kind, minutes: r.minutes })),
});

// Mock progress: the first round is done + scored, the rest not started.
function mockProgress(p: PackDetail): PackProgress {
  const rounds: PackProgressRound[] = p.rounds.map((r, i) => (
    i === 0
      ? { round: { id: r.id, title: r.title, kind: r.kind }, session_id: "mock-session", status: "done", overall: 3.2, scored: true }
      : { round: { id: r.id, title: r.title, kind: r.kind }, status: "not_started" }
  ));
  const done = rounds.filter((r) => r.status === "done" && r.overall !== undefined);
  const readiness = rounds.length ? done.reduce((s, r) => s + (r.overall! / 5), 0) / rounds.length : 0;
  return { pack: toSummary(p), rounds, overall_readiness: Number(readiness.toFixed(2)) };
}

export const packsMock: PacksSlice = {
  async listPacks(profession) {
    const all = MOCK_PACK_DETAILS.map(toSummary);
    return profession ? all.filter((p) => p.areas.includes(profession)) : all;
  },
  async getPack(id) {
    return MOCK_PACK_DETAILS.find((p) => p.id === id) ?? MOCK_PACK_DETAILS[0];
  },
  async packProgress(id) {
    return mockProgress(MOCK_PACK_DETAILS.find((p) => p.id === id) ?? MOCK_PACK_DETAILS[0]);
  },
  startRound(packId, roundId, cfg) {
    return interviewMock.createSession("", cfg, { packId, roundId });
  },
};

// Interview feature slice — the session lifecycle (create → run → finish),
// workspace/turn/behavior ingest during the interview, and the scored report +
// results history afterward. This is the "how interview results are stored / the
// APIs" surface. Owns Session, SessionHistoryItem, TranscriptTurn,
// DimensionScore, BehavioralSummary, Report. Backend: api/internal/interview
// (+ scoring, live); db: store/sessions.go + store/reports.go + store/behavior.go.

import { req, wsBase } from "../http";
import type { Modality, Phase } from "../domain";
import type { InterviewConfig } from "./profile";
import { MOCK_QUESTIONS } from "./catalog";

export interface WorkspaceSnapshot {
  kind: string;
  content: string;
  revision: number;
  data?: Record<string, unknown>;
}
export interface SessionOptions {
  minutes?: number;
  funding?: "platform" | "byok";
  provider?: string;
  model?: string;
  api_key?: string;
  mode?: "voice" | "text";
}
export interface Usage {
  funded_available: boolean;
  next_funded_at?: string;
  next_start_at?: string;
  active_session_id?: string;
  local_unlimited?: boolean;
}
export interface ProcessingReport {
  status: "scoring" | "feedback_failed";
  error?: string;
}
export interface Session {
  id: string;
  question_id: string;
  modality: Modality;
  track: string;
  status:
    | "created"
    | "reserved"
    | "active"
    | "interrupted"
    | "scoring"
    | "feedback_failed"
    | "complete"
    | "abandoned"
    | "expired";
  mode?: "voice" | "text";
  funding?: string;
  provider?: string;
  model?: string;
  duration_minutes?: number;
  started_at?: string;
  deadline_at?: string;
  workspace?: WorkspaceSnapshot;
  phase: Phase;
  config: InterviewConfig;
  pack_id?: string; // set when this session is a pack round
  pack_round_id?: string;
}

export interface SessionHistoryItem {
  id: string;
  title: string;
  question_id: string;
  modality: Modality;
  track: string;
  status: string;
  created_at: string;
  overall?: number;
  scored?: boolean;
  pack_id?: string; // set when this interview belongs to a company pack
  pack_round_id?: string;
}

export interface TranscriptTurn {
  event_id?: string;
  id?: string;
  role: "interviewer" | "candidate" | "system";
  text: string;
  ts_ms: number;
}

export interface DimensionScore {
  dimension: string;
  score: number; // 0..4
  weight: number;
  evidence: string;
  expected: string;
  actual: string;
  coverage_pct: number;
  assessed?: boolean;
}

export interface BehavioralSummary {
  filler_per_min: number;
  long_pauses: number;
  help_requests: number;
  eye_contact_pct: number;
  posture_score: number; // 0..4
  lighting_score: number; // 0..4
  framing_score: number; // 0..4
  speaking_ratio: number; // candidate talk time / total
  samples?: number;
}

export interface Report {
  learning_drills?: {
    id: string;
    title: string;
    prompt: string;
    minutes: number;
    checklist: string[];
  }[];
  scoring_version?: string;
  session_id: string;
  overall: number; // 0..4
  scores: DimensionScore[];
  behavioral: BehavioralSummary;
  strengths: string[];
  gaps: string[];
  coaching_md: string;
  question_title: string;
  scored?: boolean;
  note?: string;
  workspace?: string;
  modality?: Modality;
}

export interface InterviewSlice {
  // `pack` carries company-pack context (set by packs.startRound). When present
  // the server resolves the round's question, so questionId is sent empty.
  createSession(
    questionId: string,
    cfg: InterviewConfig,
    pack?: { packId: string; roundId: string },
    options?: SessionOptions,
  ): Promise<Session>;
  getSession(id: string): Promise<Session>;
  saveWorkspace(
    sessionId: string,
    kind: string,
    content: string,
  ): Promise<void>;
  sendTurn(
    sessionId: string,
    role: string,
    text: string,
    tsMs: number,
  ): Promise<void>;
  ingestBehavior(sessionId: string, payload: unknown): Promise<void>;
  finishSession(id: string): Promise<void>;
  getReport(sessionId: string): Promise<Report | ProcessingReport>;
  getTranscript(sessionId: string): Promise<TranscriptTurn[]>; // to reload chat on resume
  listSessions(before?: string): Promise<SessionHistoryItem[]>;
  deleteSession(id: string): Promise<void>;
  getUsage(): Promise<Usage>;
  saveSnapshot(
    id: string,
    snapshot: WorkspaceSnapshot,
  ): Promise<WorkspaceSnapshot | void>;
  validateProvider(options: SessionOptions): Promise<{
    valid: boolean;
    model?: string;
    provider?: string;
    mode?: string;
  }>;
  // Short-lived ticket for the live WebSocket (so the long-lived JWT never rides
  // in the URL). Empty string in mock mode.
  wsTicket(): Promise<string>;
  // WebSocket URL for the live interviewer relay (empty in mock mode).
  liveUrl(sessionId: string, token: string, minutes: number): string;
}

export const interviewHttp: InterviewSlice = {
  createSession(questionId, cfg, pack, options) {
    return req<Session>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({
        question_id: questionId,
        config: cfg,
        pack_id: pack?.packId,
        round_id: pack?.roundId,
        ...options,
      }),
    });
  },
  getSession(id) {
    return req<Session>(`/api/v1/sessions/${id}`);
  },
  saveWorkspace(sessionId, kind, content) {
    return req<void>(`/api/v1/sessions/${sessionId}/workspace`, {
      method: "POST",
      body: JSON.stringify({ kind, content, ts_ms: Date.now() }),
    });
  },
  sendTurn(sessionId, role, text, tsMs) {
    return req<void>(`/api/v1/sessions/${sessionId}/turns`, {
      method: "POST",
      body: JSON.stringify({ role, text, ts_ms: tsMs }),
    });
  },
  ingestBehavior(sessionId, payload) {
    return req<void>(`/api/v1/sessions/${sessionId}/behavior`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  finishSession(id) {
    return req<void>(`/api/v1/sessions/${id}/finish`, { method: "POST" });
  },
  getReport(sessionId) {
    return req<Report | ProcessingReport>(
      `/api/v1/sessions/${sessionId}/report`,
    );
  },
  getTranscript(sessionId) {
    return req<TranscriptTurn[]>(`/api/v1/sessions/${sessionId}/transcript`);
  },
  listSessions(before) {
    return req<SessionHistoryItem[]>(
      "/api/v1/sessions" +
        (before
          ? "?before=" + encodeURIComponent(before) + "&limit=50"
          : "?limit=50"),
    );
  },
  deleteSession(id) {
    return req<void>("/api/v1/sessions/" + id, { method: "DELETE" });
  },
  getUsage() {
    return req<Usage>("/api/v1/usage");
  },
  saveSnapshot(id, snapshot) {
    return req<WorkspaceSnapshot | void>(
      "/api/v1/sessions/" + id + "/workspace",
      { method: "POST", body: JSON.stringify(snapshot) },
    );
  },
  validateProvider(options) {
    return req<{
      valid: boolean;
      model?: string;
      provider?: string;
      mode?: string;
    }>("/api/v1/providers/validate", {
      method: "POST",
      body: JSON.stringify(options),
    });
  },
  async wsTicket() {
    return (await req<{ ticket: string }>("/api/v1/ws-ticket")).ticket;
  },
  liveUrl(sessionId, token, minutes) {
    return `${wsBase()}/api/v1/sessions/${sessionId}/live?token=${encodeURIComponent(token)}&minutes=${minutes}`;
  },
};

// ---- mock ----
export const MOCK_REPORT: Report = {
  session_id: "mock-session",
  question_title: "Design a URL Shortener (TinyURL)",
  overall: 2.9,
  scores: [
    {
      dimension: "requirements",
      score: 3.5,
      weight: 1,
      evidence:
        "Separated functional (shorten, redirect, analytics) from non-functional (low latency, high availability).",
      expected: "Functional + non-functional split, scope boundaries.",
      actual: "Covered both; missed custom-alias edge case.",
      coverage_pct: 80,
    },
    {
      dimension: "clarifying_questions",
      score: 3,
      weight: 1,
      evidence: "Asked about traffic scale and link lifetime.",
      expected: "Scale, read/write ratio, custom aliases, expiry.",
      actual: "Asked 3 of 5 key clarifiers.",
      coverage_pct: 60,
    },
    {
      dimension: "estimations",
      score: 2,
      weight: 1.2,
      evidence: "Estimated 100M writes/day but skipped storage/bandwidth.",
      expected: "QPS, storage/year, bandwidth, cache size.",
      actual: "Partial; math not carried through.",
      coverage_pct: 45,
    },
    {
      dimension: "api_design",
      score: 3,
      weight: 1,
      evidence: "POST /shorten, GET /{code} with 301 vs 302 discussion.",
      expected: "Create + redirect + analytics endpoints.",
      actual: "Solid; omitted rate-limit headers.",
      coverage_pct: 70,
    },
    {
      dimension: "data_model",
      score: 3,
      weight: 1,
      evidence: "code→url mapping with created_at, expiry, owner.",
      expected: "KV mapping + metadata.",
      actual: "Good.",
      coverage_pct: 75,
    },
    {
      dimension: "high_level_design",
      score: 3.5,
      weight: 1.3,
      evidence: "LB → stateless app → KV store + cache + CDN for redirects.",
      expected: "LB, app tier, KV, cache, CDN.",
      actual: "Clean and correct.",
      coverage_pct: 85,
    },
    {
      dimension: "depth_reasoning",
      score: 3,
      weight: 1.2,
      evidence: "Justified base62 over hashing to avoid collisions.",
      expected: "Reasoned tradeoffs on encoding + storage.",
      actual: "Good reasoning; light on failure tradeoffs.",
      coverage_pct: 65,
    },
    {
      dimension: "deep_dive",
      score: 2.5,
      weight: 1.2,
      evidence:
        "Handled counter-based ID generation follow-up; hesitated on distributed counters.",
      expected: "Key generation, collisions, hot keys.",
      actual: "Partial depth.",
      coverage_pct: 55,
    },
    {
      dimension: "scaling",
      score: 3,
      weight: 1.1,
      evidence: "Sharded KV by code prefix; cache for hot links.",
      expected: "Sharding, replication, caching.",
      actual: "Good.",
      coverage_pct: 70,
    },
    {
      dimension: "bottlenecks",
      score: 2.5,
      weight: 1,
      evidence: "Identified cache as hot path; missed ID-generator as SPOF.",
      expected: "Identify + mitigate top bottlenecks.",
      actual: "Partial.",
      coverage_pct: 55,
    },
    {
      dimension: "reliability",
      score: 2,
      weight: 1,
      evidence:
        "Mentioned replicas; no discussion of failover or backpressure.",
      expected: "Failure modes, replication, graceful degradation.",
      actual: "Thin.",
      coverage_pct: 40,
    },
    {
      dimension: "observability",
      score: 2,
      weight: 0.8,
      evidence: "Would log redirects; no metrics/tracing specifics.",
      expected: "Metrics, logs, traces, alerting.",
      actual: "Thin.",
      coverage_pct: 40,
    },
    {
      dimension: "security",
      score: 2.5,
      weight: 0.8,
      evidence: "Noted malicious-URL scanning and rate limiting.",
      expected: "Abuse, auth, malicious links.",
      actual: "Reasonable.",
      coverage_pct: 55,
    },
    {
      dimension: "coverage",
      score: 3,
      weight: 1,
      evidence: "Touched 6 of 8 core components and 3 of 5 deep-dives.",
      expected: "Breadth across the reference design.",
      actual: "Good breadth.",
      coverage_pct: 68,
    },
  ],
  behavioral: {
    filler_per_min: 4.2,
    long_pauses: 3,
    help_requests: 1,
    eye_contact_pct: 71,
    posture_score: 3,
    lighting_score: 2.5,
    framing_score: 3,
    speaking_ratio: 0.62,
  },
  strengths: [
    "Clear structure — requirements before design.",
    "Correct, clean high-level architecture.",
    "Good justification of base62 encoding.",
  ],
  gaps: [
    "Back-of-envelope math not carried through to storage/bandwidth.",
    "Reliability and failure modes were thin.",
    "Filler-word rate (~4/min) reduced clarity in the deep-dive.",
  ],
  coaching_md:
    '## Where you stood out\n\nYou led with a crisp requirements pass and a clean high-level design. Your encoding choice was well justified.\n\n## Highest-leverage improvements\n\n1. **Finish your estimations.** You started strong (100M writes/day) but never reached storage/year or cache size. Interviewers read this as incomplete rigor.\n2. **Name failure modes proactively.** When you place a datastore, immediately cover replication, failover, and what happens when it\'s down.\n3. **Tighten delivery.** ~4 filler words/min and a few long pauses in the deep-dive. A brief pause to think reads better than "um."\n',
};

function demoSessions(): Record<string, Session & { created_at: string }> {
  try {
    return JSON.parse(localStorage.getItem("mi_mock_sessions") ?? "{}");
  } catch {
    return {};
  }
}
function storeDemoSessions(sessions: ReturnType<typeof demoSessions>) {
  localStorage.setItem("mi_mock_sessions", JSON.stringify(sessions));
}
function demoTurns(): Record<string, TranscriptTurn[]> {
  try {
    return JSON.parse(localStorage.getItem("mi_mock_turns") ?? "{}");
  } catch {
    return {};
  }
}
export const interviewMock: InterviewSlice = {
  async deleteSession(id) {
    const sessions = demoSessions();
    delete sessions[id];
    storeDemoSessions(sessions);
    const turns = demoTurns();
    delete turns[id];
    localStorage.setItem("mi_mock_turns", JSON.stringify(turns));
  },
  async getUsage() {
    return { funded_available: true, local_unlimited: true };
  },
  async saveSnapshot(id, snapshot) {
    const sessions = demoSessions();
    if (sessions[id]) {
      sessions[id].workspace = snapshot;
      storeDemoSessions(sessions);
    }
    return snapshot;
  },
  async validateProvider() {
    throw new Error(
      "A simulated demo cannot validate model credentials. Run the API locally to use your own provider.",
    );
  },
  async createSession(questionId, cfg, pack, options) {
    let q = MOCK_QUESTIONS.find((x) => x.id === questionId);
    if (pack) {
      const { packsMock } = await import("./packs");
      const detail = await packsMock.getPack(pack.packId);
      const round = detail.rounds.find((r) => r.id === pack.roundId);
      q =
        MOCK_QUESTIONS.find((x) => x.modality === round?.modality) ??
        MOCK_QUESTIONS[0];
    }
    q ??= MOCK_QUESTIONS[0];
    const started = new Date();
    const minutes = options?.minutes ?? 30;
    const session: Session & { created_at: string } = {
      id: crypto.randomUUID(),
      question_id: q.id,
      modality: q.modality,
      track: q.track,
      status: "active",
      phase: "intro",
      config: cfg,
      pack_id: pack?.packId,
      pack_round_id: pack?.roundId,
      mode: options?.mode ?? "text",
      funding: "demo",
      provider: "simulated",
      duration_minutes: minutes,
      created_at: started.toISOString(),
      started_at: started.toISOString(),
      deadline_at: new Date(started.getTime() + minutes * 60000).toISOString(),
    };
    const sessions = demoSessions();
    sessions[session.id] = session;
    storeDemoSessions(sessions);
    return session;
  },
  async getSession(id) {
    const session = demoSessions()[id];
    if (!session)
      throw new Error(
        "This demo interview was not found in this browser. Start a new practice attempt.",
      );
    return session;
  },
  async saveWorkspace(id, kind, content) {
    const session = await interviewMock.getSession(id);
    await interviewMock.saveSnapshot(id, {
      kind,
      content,
      revision: (session.workspace?.revision ?? 0) + 1,
    });
  },
  async sendTurn(id, role, text, ts_ms) {
    const turns = demoTurns();
    (turns[id] ??= []).push({
      role: role as TranscriptTurn["role"],
      text,
      ts_ms,
    });
    localStorage.setItem("mi_mock_turns", JSON.stringify(turns));
  },
  async ingestBehavior() {},
  async finishSession(id) {
    const sessions = demoSessions();
    if (sessions[id]) {
      sessions[id].status = "complete";
      storeDemoSessions(sessions);
    }
  },
  async getReport(sessionId) {
    const session = demoSessions()[sessionId];
    return {
      ...MOCK_REPORT,
      session_id: sessionId,
      question_title:
        MOCK_QUESTIONS.find((q) => q.id === session?.question_id)?.title ??
        "Simulated feedback",
      overall: 0,
      scored: false,
      scores: [],
      strengths: [],
      gaps: [],
      coaching_md: "",
      note: "This simulated interview has no model assessment. Connect the API to receive evidence-based feedback on your actual answers.",
      learning_drills: [
        {
          id: "structure",
          title: "Make one answer concrete",
          minutes: 5,
          prompt:
            "Choose one of your answers. Rewrite it with the situation, your specific action, the result, and what you learned.",
          checklist: [
            "Name your own contribution",
            "Support the outcome with evidence",
            "Identify one change for next time",
          ],
        },
      ],
    };
  },
  async getTranscript(id) {
    return demoTurns()[id] ?? [];
  },
  async listSessions() {
    return Object.values(demoSessions())
      .map((s) => ({
        id: s.id,
        title:
          MOCK_QUESTIONS.find((q) => q.id === s.question_id)?.title ??
          "Practice interview",
        question_id: s.question_id,
        modality: s.modality,
        track: s.track,
        status: s.status,
        created_at: s.created_at,
        scored: false,
        pack_id: s.pack_id,
        pack_round_id: s.pack_round_id,
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async wsTicket() {
    return "";
  },
  liveUrl() {
    return "";
  },
};

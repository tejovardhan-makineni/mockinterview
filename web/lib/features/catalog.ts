// Question-catalog feature slice — the browsable interview corpus (client-safe
// summaries; reference answers stay server-side). Owns QuestionSummary.
// Backend: api/internal/corpus + api/data/corpus/*.json.

import { req } from "../http";
import type { Modality } from "../domain";

// A question as served to the client (a trimmed view of the corpus entry — the
// reference answer and deep-dive banks stay server-side so they can't be seen).
export interface QuestionSummary {
  id: string;
  title: string;
  track: string;       // engineering | professional
  domain: string;      // sub-topic: system_design | coding | clinical_reasoning | ...
  areas: string[];     // professions this interview is valid for (shared): engineering, medicine, ...
  modality: Modality;
  difficulty: "junior" | "mid" | "senior" | "staff" | "entry";
  tags: string[];
  prompt: string;
  blurb: string;
}

export interface CatalogSlice {
  listQuestions(): Promise<QuestionSummary[]>;
  getQuestion(id: string): Promise<QuestionSummary>;
}

export const catalogHttp: CatalogSlice = {
  listQuestions() { return req<QuestionSummary[]>("/api/v1/questions"); },
  getQuestion(id) { return req<QuestionSummary>(`/api/v1/questions/${id}`); },
};

// matchScore is the catalog's fuzzy search ranking. It rewards exact substring
// hits and token overlap (including 4+ char prefix matches) so close/partial
// queries surface, not just exact ones. Returns 1 for an empty query (show all),
// 3 for a full-string substring hit, else the fraction of query tokens matched.
// Lives here (not in the page) so it can be unit-tested and reused.
export function matchScore(q: QuestionSummary, query: string): number {
  const s = query.trim().toLowerCase();
  if (!s) return 1;
  const hay = `${q.title} ${q.domain} ${q.track} ${q.tags.join(" ")} ${q.blurb}`.toLowerCase();
  if (hay.includes(s)) return 3;
  const toks = s.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const t of toks) {
    if (hay.includes(t)) { hits += 1; continue; }
    if (hay.split(/\W+/).some((w) => w.length >= 4 && (w.startsWith(t.slice(0, 4)) || t.startsWith(w.slice(0, 4))))) hits += 0.5;
  }
  return hits / toks.length;
}

// ---- mock ----
export const MOCK_QUESTIONS: QuestionSummary[] = [
  { id: "url-shortener", title: "Design a URL Shortener (TinyURL)", track: "engineering", domain: "system_design", areas: ["software_engineering"], modality: "system_design", difficulty: "mid", tags: ["hashing", "kv-store", "caching"], prompt: "Design a service that turns long URLs into short links and redirects users.", blurb: "The classic read-heavy KV design — hashing, collisions, cache, analytics." },
  { id: "rag-service", title: "Design a RAG Service (LLM + Retrieval)", track: "engineering", domain: "ml_system_design", areas: ["software_engineering", "data_science"], modality: "system_design", difficulty: "senior", tags: ["ai", "vector-db", "embeddings"], prompt: "Design a retrieval-augmented generation service answering over private docs.", blurb: "Chunking, embeddings, vector search, reranking, and grounding an LLM." },
  { id: "lru-cache", title: "Implement an LRU Cache", track: "engineering", domain: "coding", areas: ["software_engineering", "data_science"], modality: "coding", difficulty: "mid", tags: ["hashmap", "linked-list", "O(1)"], prompt: "Implement an LRU cache with O(1) get and put. Code it in the editor — no compiler, walk me through it.", blurb: "Doc-style coding (no run/compile) — hashmap + doubly linked list." },
  { id: "thermo-cycle-sizing", title: "Size a Steam Power Cycle (Rankine)", track: "engineering", domain: "thermodynamics", areas: ["mechanical_engineering"], modality: "conversational", difficulty: "mid", tags: ["rankine", "thermodynamics", "efficiency"], prompt: "Size a Rankine steam cycle to deliver a target net power output. Walk me through your assumptions and the energy balance.", blurb: "Spoken station — cycle states, energy balance, efficiency, and practical tradeoffs." },
  { id: "beam-load-analysis", title: "Analyze a Loaded Cantilever Beam", track: "engineering", domain: "mechanics", areas: ["mechanical_engineering"], modality: "conversational", difficulty: "mid", tags: ["statics", "bending", "stress", "safety-factor"], prompt: "A cantilever beam carries a point load at its tip. Talk me through reactions, the bending-moment diagram, peak stress, and whether it's safe.", blurb: "Spoken statics station — free body, shear/moment, bending stress, factor of safety." },
  { id: "opamp-circuit-analysis", title: "Analyze an Op-Amp Amplifier", track: "engineering", domain: "circuits", areas: ["electrical_engineering"], modality: "conversational", difficulty: "mid", tags: ["op-amp", "gain", "feedback", "analog"], prompt: "Given a non-inverting op-amp stage, derive the gain, then reason about bandwidth, input/output impedance, and real-world non-idealities.", blurb: "Spoken analog station — ideal-op-amp assumptions, gain, and where reality bites." },
  { id: "structural-load-path", title: "Trace a Building's Gravity Load Path", track: "engineering", domain: "structural", areas: ["civil_engineering"], modality: "conversational", difficulty: "mid", tags: ["load-path", "beams", "columns", "foundations"], prompt: "Walk me through how gravity load travels from a floor slab down to the foundation, and how you'd size a representative beam.", blurb: "Spoken structural station — load path, tributary areas, member sizing, safety." },
  { id: "behavioral-ownership", title: "Behavioral: Ownership", track: "professional", domain: "behavioral", areas: ["software_engineering", "mechanical_engineering", "electrical_engineering", "civil_engineering", "data_science", "medicine", "nursing", "law", "consulting", "product_management", "finance"], modality: "conversational", difficulty: "mid", tags: ["ownership", "STAR", "leadership"], prompt: "Tell me about a time you took ownership of a problem outside your formal responsibilities.", blurb: "Shared behavioral station — valid for every profession; STAR structure and real impact." },
  { id: "clinical-reasoning-chest-pain", title: "Acute Chest Pain — Clinical Reasoning", track: "professional", domain: "clinical_reasoning", areas: ["medicine"], modality: "conversational", difficulty: "mid", tags: ["differential", "SOCRATES", "safety"], prompt: "A patient presents with acute chest pain. Talk me through your approach.", blurb: "Spoken station — history, life-threatening-first differential, workup." },
  { id: "law-issue-spotting-contract", title: "Contract Issue-Spotting (IRAC)", track: "professional", domain: "issue_spotting", areas: ["law"], modality: "written", difficulty: "mid", tags: ["IRAC", "contracts"], prompt: "Read the fact pattern and write an IRAC analysis of the contract-formation issues.", blurb: "Written doc — spot issues, state rules, apply, conclude." },
  { id: "case-market-entry", title: "Market Entry Case", track: "professional", domain: "case", areas: ["consulting"], modality: "conversational", difficulty: "senior", tags: ["structure", "hypothesis", "quant"], prompt: "Should our client enter a new market? Structure your approach.", blurb: "Spoken case — MECE structure, hypothesis, back-of-envelope math." },
];

export const catalogMock: CatalogSlice = {
  async listQuestions() { return MOCK_QUESTIONS; },
  async getQuestion(id) { return MOCK_QUESTIONS.find((q) => q.id === id) ?? MOCK_QUESTIONS[0]; },
};

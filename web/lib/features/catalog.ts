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
  domain: string;      // system_design | coding | medicine | law | ...
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
  { id: "url-shortener", title: "Design a URL Shortener (TinyURL)", track: "engineering", domain: "system_design", modality: "system_design", difficulty: "mid", tags: ["hashing", "kv-store", "caching"], prompt: "Design a service that turns long URLs into short links and redirects users.", blurb: "The classic read-heavy KV design — hashing, collisions, cache, analytics." },
  { id: "rag-service", title: "Design a RAG Service (LLM + Retrieval)", track: "engineering", domain: "ml_system_design", modality: "system_design", difficulty: "senior", tags: ["ai", "vector-db", "embeddings"], prompt: "Design a retrieval-augmented generation service answering over private docs.", blurb: "Chunking, embeddings, vector search, reranking, and grounding an LLM." },
  { id: "lru-cache", title: "Implement an LRU Cache", track: "engineering", domain: "coding", modality: "coding", difficulty: "mid", tags: ["hashmap", "linked-list", "O(1)"], prompt: "Implement an LRU cache with O(1) get and put. Code it in the editor — no compiler, walk me through it.", blurb: "Doc-style coding (no run/compile) — hashmap + doubly linked list." },
  { id: "clinical-reasoning-chest-pain", title: "Acute Chest Pain — Clinical Reasoning", track: "professional", domain: "medicine", modality: "conversational", difficulty: "mid", tags: ["differential", "SOCRATES", "safety"], prompt: "A patient presents with acute chest pain. Talk me through your approach.", blurb: "Spoken station — history, life-threatening-first differential, workup." },
  { id: "law-issue-spotting-contract", title: "Contract Issue-Spotting (IRAC)", track: "professional", domain: "law", modality: "written", difficulty: "mid", tags: ["IRAC", "contracts"], prompt: "Read the fact pattern and write an IRAC analysis of the contract-formation issues.", blurb: "Written doc — spot issues, state rules, apply, conclude." },
  { id: "case-market-entry", title: "Market Entry Case", track: "professional", domain: "consulting_case", modality: "conversational", difficulty: "senior", tags: ["structure", "hypothesis", "quant"], prompt: "Should our client enter a new market? Structure your approach.", blurb: "Spoken case — MECE structure, hypothesis, back-of-envelope math." },
];

export const catalogMock: CatalogSlice = {
  async listQuestions() { return MOCK_QUESTIONS; },
  async getQuestion(id) { return MOCK_QUESTIONS.find((q) => q.id === id) ?? MOCK_QUESTIONS[0]; },
};

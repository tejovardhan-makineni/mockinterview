// Question-catalog feature slice — the browsable interview corpus (client-safe
// summaries; reference answers stay server-side). Owns QuestionSummary.
// Backend: api/internal/corpus + api/data/corpus/*.json.

import { req } from "../http";
import preview from "./catalog-preview.json";
import type { Modality } from "../domain";
import type { Profession, SpecialistAgent } from "./profile";

// A question as served to the client (a trimmed view of the corpus entry — the
// reference answer and deep-dive banks stay server-side so they can't be seen).
export interface QuestionSummary {
  id: string;
  format_id?: string;
  format_name?: string;
  agent?: SpecialistAgent;
  review_status?: string;
  minutes?: number;
  revision?: number;
  title: string;
  track: string; // engineering | professional
  domain: string; // sub-topic: system_design | coding | clinical_reasoning | ...
  areas: string[]; // professions this interview is valid for (shared): engineering, medicine, ...
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
  listQuestions() {
    return req<QuestionSummary[]>("/api/v1/questions");
  },
  getQuestion(id) {
    return req<QuestionSummary>(`/api/v1/questions/${id}`);
  },
};

// Search the scenario and its own specialist first. Additional eligible roles
// provide useful context, but shared career practice must not bury a teacher's
// classroom scenario when someone searches for "teacher".
const searchable = (value: string) =>
  value.toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();

export function matchScore(
  q: QuestionSummary,
  query: string,
  professions: Profession[] = [],
): number {
  const s = searchable(query);
  if (!s) return 1;
  const roleText = (profession: Profession) =>
    [
      profession.label,
      profession.family_label,
      ...(profession.aliases ?? []),
      profession.agent?.name,
      profession.agent?.summary,
    ]
      .filter(Boolean)
      .join(" ");
  const primary = professions.filter((p) => p.key === q.areas[0]);
  const additional = professions.filter((p) =>
    q.areas.slice(1).includes(p.key),
  );
  const hay = searchable(
    [
      q.title,
      q.domain,
      q.track,
      q.areas[0],
      ...q.tags,
      q.blurb,
      q.prompt,
      q.format_name,
      q.format_id,
      q.agent?.name,
      q.agent?.summary,
      ...primary.map(roleText),
    ]
      .filter(Boolean)
      .join(" "),
  );
  const context = searchable(
    [...q.areas.slice(1), ...additional.map(roleText)].join(" "),
  );
  const words = hay.split(/\W+/);
  const contextWords = context.split(/\W+/);
  // Short job aliases must be words: "HR" should not match "through".
  const contains = (source: string, tokens: string[], term: string) =>
    term.length <= 3 ? tokens.includes(term) : source.includes(term);
  const prefix = (tokens: string[], term: string) =>
    term.length >= 4 &&
    tokens.some(
      (word) =>
        word.length >= 4 &&
        (word.startsWith(term.slice(0, 4)) ||
          term.startsWith(word.slice(0, 4))),
    );
  if (contains(hay, words, s)) return 3;
  const toks = s.split(/\s+/).filter(Boolean);
  let hits = 0;
  for (const token of toks) {
    if (contains(hay, words, token)) hits += 1;
    else if (prefix(words, token)) hits += 0.5;
    else if (contains(context, contextWords, token)) hits += 0.4;
    else if (prefix(contextWords, token)) hits += 0.2;
  }
  return hits / toks.length;
}

export interface CatalogFilters {
  query?: string;
  family?: string;
  profession?: string;
  topic?: string;
  format?: string;
  level?: string;
  workspace?: string;
}

// Filtering runs over the whole collection before the page applies its display
// limit. Families come from the profession registry, never a separate UI list.
export function filterCatalog(
  questions: QuestionSummary[],
  professions: Profession[],
  filters: CatalogFilters,
): QuestionSummary[] {
  const familyAreas = new Set(
    professions.filter((p) => p.family === filters.family).map((p) => p.key),
  );
  return questions
    .filter(
      (q) =>
        (!filters.family || q.areas.some((area) => familyAreas.has(area))) &&
        (!filters.profession || q.areas.includes(filters.profession)) &&
        (!filters.topic || q.domain === filters.topic) &&
        (!filters.format || q.format_id === filters.format) &&
        (!filters.level || q.difficulty === filters.level) &&
        (!filters.workspace || q.modality === filters.workspace),
    )
    .map((q) => ({ q, score: matchScore(q, filters.query ?? "", professions) }))
    .filter(({ score }) => score > 0.34)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.q.areas[0] === filters.profession) -
          Number(a.q.areas[0] === filters.profession),
    )
    .map(({ q }) => q);
}

// ---- mock ----
// A small client-safe snapshot generated from the corpus Summary/Professions
// projections. It contains public practice briefs and specialist descriptions;
// reference answers and interviewer instructions are never bundled here.
export const MOCK_QUESTIONS: QuestionSummary[] =
  preview.questions as QuestionSummary[];

export const catalogMock: CatalogSlice = {
  async listQuestions() {
    return MOCK_QUESTIONS;
  },
  async getQuestion(id) {
    return MOCK_QUESTIONS.find((q) => q.id === id) ?? MOCK_QUESTIONS[0];
  },
};

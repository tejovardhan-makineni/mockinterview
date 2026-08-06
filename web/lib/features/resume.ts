// Resume feature slice — upload, fetch, and AI review of the candidate's
// resume. Fully self-contained: owns ResumeParsed, Resume, ResumeReview, and
// the review mock data. Backend: api/internal/resume; db: store/resumes.go.
// This is the "improve resume review in isolation" example — change it here and
// in those two backend files only.

import { req, BASE, authHeader } from "../http";

export interface ResumeParsed {
  name?: string;
  headline?: string;
  years_experience?: number;
  skills?: string[];
  projects?: { name: string; summary: string; tech?: string[] }[];
  summary?: string;
}

export interface Resume {
  id: string;
  filename: string;
  parsed: ResumeParsed;
  text?: string;
}

export interface ResumeReview {
  overall_score: number; // 0..5
  summary: string;
  strengths: string[];
  gaps: string[];
  line_edits: { original: string; improved: string }[];
  impact_suggestions: string[];
  ats_notes: string;
}

export interface ResumeSlice {
  uploadResume(file: File): Promise<Resume>;
  getResume(): Promise<Resume | null>;
  reviewResume(): Promise<ResumeReview>;
}

export const resumeHttp: ResumeSlice = {
  async uploadResume(file) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(BASE + "/api/v1/resume", { method: "POST", headers: authHeader(), body: fd });
    if (!res.ok) throw new Error("upload failed");
    return res.json() as Promise<Resume>;
  },
  async getResume() { try { return await req<Resume>("/api/v1/resume"); } catch { return null; } },
  reviewResume() { return req<ResumeReview>("/api/v1/resume/review", { method: "POST" }); },
};

// ---- mock ----
const RESUME_KEY = "mi_mock_resume";

export const MOCK_RESUME_REVIEW: ResumeReview = {
  overall_score: 3.4,
  summary: "Strong backend experience; impact is under-quantified and the summary buries the lead.",
  strengths: [
    "Clear distributed-systems focus with concrete scale (5k TPS).",
    "Good tech breadth across storage, streaming, and search.",
  ],
  gaps: [
    "Bullets describe responsibilities, not outcomes.",
    "No metrics on latency/cost/reliability improvements.",
    "Summary line is generic.",
  ],
  line_edits: [
    { original: "Worked on the payments ledger service.", improved: "Designed an idempotent double-entry ledger sustaining 5k TPS with zero reconciliation drift over 12 months." },
    { original: "Responsible for search platform.", improved: "Owned a 3-region typeahead service, cutting p99 from 120ms to 40ms and halving index cost." },
  ],
  impact_suggestions: [
    "Quantify every bullet: %, latency, $, scale, or time saved.",
    "Lead each role with your single biggest result.",
  ],
  ats_notes: "Include role-relevant keywords (Kafka, CDC, sharding) verbatim; keep to a single-column layout for parser compatibility.",
};

export const resumeMock: ResumeSlice = {
  async uploadResume(file) {
    const resume: Resume = {
      id: "mock-resume",
      filename: file.name,
      text: "Alex Candidate\nSenior Software Engineer · alex@example.com · San Francisco, CA\n\nSUMMARY\nBackend-leaning engineer with distributed systems and payments experience.\n\nEXPERIENCE\nAcme Corp — Senior Software Engineer (2021–present)\nWorked on the payments ledger service.\nResponsible for search platform.\nHelped with various backend tasks and improvements.\n\nGlobex — Software Engineer (2018–2021)\nBuilt internal tools and APIs.\nParticipated in on-call rotation.\n\nSKILLS\nGo, Distributed Systems, Postgres, Kubernetes, gRPC, Kafka, Redis, Elasticsearch\n\nEDUCATION\nB.S. Computer Science",
      parsed: {
        name: "Alex Candidate", headline: "Senior Software Engineer", years_experience: 7,
        skills: ["Go", "Distributed Systems", "Postgres", "Kubernetes", "gRPC"],
        projects: [
          { name: "Payments Ledger", summary: "Idempotent double-entry ledger at 5k TPS.", tech: ["Go", "Postgres", "Kafka"] },
          { name: "Search Platform", summary: "Typeahead service p99 < 40ms across 3 regions.", tech: ["Elasticsearch", "Redis"] },
        ],
        summary: "Backend-leaning engineer with distributed systems + payments depth.",
      },
    };
    if (typeof window !== "undefined") window.localStorage.setItem(RESUME_KEY, JSON.stringify(resume));
    return resume;
  },
  async getResume() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as Resume) : null;
  },
  async reviewResume() { return MOCK_RESUME_REVIEW; },
};

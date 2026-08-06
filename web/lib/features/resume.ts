// Resume feature slice — upload, fetch, AI review, and job-match of the
// candidate's resume. Fully self-contained: owns ResumeParsed, Resume,
// ResumeReview, ResumeMatch + the mock data. Backend: api/internal/resume; db:
// store/resumes.go. This is the "improve resume review in isolation" example —
// change it here and in those two backend files only.

import { req, BASE, authHeader } from "../http";

// ---- structured resume (renderable document) ----
export interface ResumeContact {
  location?: string;
  email?: string;
  phone?: string;
  links?: string[];
}
export interface ResumeExperience {
  company?: string;
  role?: string;
  start?: string;
  end?: string;
  bullets?: string[];
}
export interface ResumeEducation {
  school?: string;
  degree?: string;
  dates?: string;
}
export interface ResumeSkillGroup {
  category?: string;
  items?: string[];
}
export interface ResumeParsed {
  name?: string;
  headline?: string;
  years_experience?: number;
  contact?: ResumeContact;
  summary?: string;
  experience?: ResumeExperience[];
  education?: ResumeEducation[];
  skills?: ResumeSkillGroup[] | string[]; // grouped preferred; flat list tolerated for back-compat
  projects?: { name: string; summary: string; tech?: string[] }[];
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
  // Enriched fields (optional — older data omits them).
  critical_fixes?: { title: string; location: string; detail: string }[];
  quantifiable_impacts?: { text: string; note: string }[];
  ats_breakdown?: { formatting: string; keyword_match: number; notes: string };
}

export interface ResumeMatch {
  match_score: number; // 0..100
  verdict: string;
  matched_keywords: string[];
  missing_keywords: string[];
  strengths: string[];
  gaps: string[];
  tailoring_suggestions: { issue: string; detail: string; suggestion: string }[];
  ats_keyword_match: number; // 0..100
}

export interface ResumeSlice {
  uploadResume(file: File): Promise<Resume>;
  getResume(): Promise<Resume | null>;
  reviewResume(): Promise<ResumeReview>;
  matchResume(jd: string): Promise<ResumeMatch>;
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
  matchResume(jd: string) {
    return req<ResumeMatch>("/api/v1/resume/match", { method: "POST", body: JSON.stringify({ job_description: jd }) });
  },
};

// ---- mock ----
const RESUME_KEY = "mi_mock_resume";

const MOCK_PARSED: ResumeParsed = {
  name: "Alex Candidate",
  headline: "Senior Software Engineer",
  years_experience: 7,
  contact: { location: "San Francisco, CA", email: "alex@example.com", phone: "(555) 123-4567", links: ["github.com/alexc", "linkedin.com/in/alexc"] },
  summary: "Backend-leaning engineer with distributed systems and payments experience.",
  experience: [
    {
      company: "Acme Corp", role: "Senior Software Engineer", start: "2021", end: "Present",
      bullets: [
        "Worked on the payments ledger service.",
        "Responsible for search platform.",
        "Helped with various backend tasks and improvements.",
      ],
    },
    {
      company: "Globex", role: "Software Engineer", start: "2018", end: "2021",
      bullets: ["Built internal tools and APIs.", "Participated in on-call rotation."],
    },
  ],
  education: [{ school: "State University", degree: "B.S. Computer Science", dates: "2014 – 2018" }],
  skills: [
    { category: "Languages", items: ["Go", "Python", "TypeScript"] },
    { category: "Infrastructure", items: ["Distributed Systems", "Postgres", "Kubernetes", "gRPC", "Kafka", "Redis", "Elasticsearch"] },
  ],
  projects: [
    { name: "Payments Ledger", summary: "Idempotent double-entry ledger at 5k TPS.", tech: ["Go", "Postgres", "Kafka"] },
    { name: "Search Platform", summary: "Typeahead service p99 < 40ms across 3 regions.", tech: ["Elasticsearch", "Redis"] },
  ],
};

const MOCK_TEXT = "Alex Candidate\nSenior Software Engineer · alex@example.com · San Francisco, CA\n\nSUMMARY\nBackend-leaning engineer with distributed systems and payments experience.\n\nEXPERIENCE\nAcme Corp — Senior Software Engineer (2021–present)\nWorked on the payments ledger service.\nResponsible for search platform.\nHelped with various backend tasks and improvements.\n\nGlobex — Software Engineer (2018–2021)\nBuilt internal tools and APIs.\nParticipated in on-call rotation.\n\nSKILLS\nGo, Distributed Systems, Postgres, Kubernetes, gRPC, Kafka, Redis, Elasticsearch\n\nEDUCATION\nB.S. Computer Science";

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
  critical_fixes: [
    { title: "Vague responsibility bullet", location: "Experience 1, bullet 1", detail: "'Worked on the payments ledger service' states no outcome, scale, or metric." },
    { title: "Filler bullet dilutes impact", location: "Experience 1, bullet 3", detail: "'Helped with various backend tasks' says nothing measurable — cut it or replace with a result." },
  ],
  quantifiable_impacts: [
    { text: "5k TPS with zero reconciliation drift over 12 months", note: "Concrete throughput + reliability window — exactly what recruiters scan for." },
    { text: "p99 from 120ms to 40ms", note: "Clear before/after latency win." },
  ],
  ats_breakdown: { formatting: "pass", keyword_match: 72, notes: "Single-column, standard headings. Add missing hard skills (CDC, sharding) verbatim to lift keyword match." },
};

export const MOCK_RESUME_MATCH: ResumeMatch = {
  match_score: 68,
  verdict: "Strong backend fit; missing a few explicitly-required cloud + streaming keywords.",
  matched_keywords: ["Go", "Postgres", "Kubernetes", "Distributed Systems", "Kafka"],
  missing_keywords: ["AWS", "Terraform", "gRPC streaming", "observability"],
  strengths: [
    "Direct distributed-systems and payments experience aligns with the core of the role.",
    "Demonstrated ownership at scale (5k TPS, p99 40ms).",
  ],
  gaps: [
    "No explicit cloud provider (AWS/GCP) named though the JD requires it.",
    "Infrastructure-as-code (Terraform) not mentioned.",
  ],
  tailoring_suggestions: [
    { issue: "Cloud keywords absent", detail: "The JD lists AWS as required; the resume never names a cloud.", suggestion: "Add the specific AWS services you used (EKS, RDS, SQS) to the relevant role." },
    { issue: "IaC not surfaced", detail: "Terraform is a listed must-have.", suggestion: "If you've written Terraform/Pulumi, add a bullet quantifying what it provisioned." },
  ],
  ats_keyword_match: 64,
};

export const resumeMock: ResumeSlice = {
  async uploadResume(file) {
    const resume: Resume = { id: "mock-resume", filename: file.name, text: MOCK_TEXT, parsed: MOCK_PARSED };
    if (typeof window !== "undefined") window.localStorage.setItem(RESUME_KEY, JSON.stringify(resume));
    return resume;
  },
  async getResume() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(RESUME_KEY);
    return raw ? (JSON.parse(raw) as Resume) : null;
  },
  async reviewResume() { return MOCK_RESUME_REVIEW; },
  async matchResume() { return MOCK_RESUME_MATCH; },
};

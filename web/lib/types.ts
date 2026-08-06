// Back-compat barrel. Types now live with the feature that owns them under
// lib/features/*; shared vocabulary lives in lib/domain.ts. This file just
// re-exports everything so existing `import { X } from "@/lib/types"` keeps
// working. Prefer importing from the owning feature in new code.

export type { Personality, Modality, Phase } from "./domain";
export type { User, AuthResult } from "./features/auth";
export type { Profile, InterviewConfig, Voice, Face } from "./features/profile";
export type { ResumeParsed, Resume, ResumeReview, ResumeMatch, ResumeExperience, ResumeEducation, ResumeSkillGroup, ResumeContact } from "./features/resume";
export type { QuestionSummary } from "./features/catalog";
export type {
  Session, SessionHistoryItem, TranscriptTurn, DimensionScore,
  BehavioralSummary, Report,
} from "./features/interview";

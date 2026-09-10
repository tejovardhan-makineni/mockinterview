import type { InterviewConfig } from "./features/profile";
export interface SetupDraft {
  config: Partial<InterviewConfig>;
  minutes: number;
  mode: "voice" | "text";
  funding: "platform" | "byok";
  provider: string;
  model: string;
}
export function writeSetupDraft(key: string, draft: SetupDraft) {
  const {
    voice_id,
    face_id,
    personality,
    intensity,
    target_level,
    challenge,
    practice_mode,
    language,
  } = draft.config;
  const safe = {
    minutes: draft.minutes,
    mode: draft.mode,
    funding: draft.funding,
    provider: draft.provider,
    model: draft.model,
    config: {
      voice_id,
      face_id,
      personality,
      intensity,
      target_level,
      challenge,
      practice_mode,
      language,
    },
    expires: Date.now() + 30 * 60_000,
  };
  try {
    sessionStorage.setItem(key, JSON.stringify(safe));
  } catch {
    /* preference recovery is optional */
  }
}
export function readSetupDraft(key: string): SetupDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (
      !value ||
      value.expires < Date.now() ||
      !Number.isFinite(value.minutes) ||
      value.minutes < 8 ||
      value.minutes > 60 ||
      typeof value.config !== "object"
    )
      return null;
    return value as SetupDraft;
  } catch {
    return null;
  }
}

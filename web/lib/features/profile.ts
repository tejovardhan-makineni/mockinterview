// Profile & interviewer-config feature slice — the user's profile, the
// interviewer configuration (voice/face/personality/intensity), the voice &
// face catalogs, voice preview, and account deletion. Owns Profile,
// InterviewConfig, Voice, Face. Backend: api/internal/profile; db:
// store/users.go + store/config.go.

import { req, BASE, authHeader } from "../http";
import type { Personality } from "../domain";

export interface Profile {
  name?: string;
  dob?: string;                       // YYYY-MM-DD
  gender?: string;                    // female | male | nonbinary | prefer_not
  status?: "student" | "working" | "other";
  occupation?: string;                // free text (e.g. "Software Engineer", "Medical Resident")
  domain?: string;                    // preferred interview domain (matches corpus domains)
  years_experience?: number;
  target_role?: string;
}

export interface InterviewConfig {
  voice_id: string;
  face_id: string;
  personality: Personality;
  intensity: number; // 1..5
  language?: string; // interview language code (interviewer speaks it); set from the app language at start
}

export interface Voice {
  id: string;
  label: string;
  gender: string;
  sample?: string;
}

export interface Face {
  id: string;
  label: string;
  gltf: string;
  thumb?: string;
}

// A selectable interviewer demeanor as served by GET /personalities. Mirrors
// api/internal/persona.Personality's CLIENT-facing fields (the prompt Directive
// is server-only, json:"-"). `blurb` is the one-line description shown in the
// persona picker.
export interface PersonalityOption {
  id: string;
  label: string;
  blurb: string;
}

// PreviewReq is the full interviewer combo whose delivery (words + tone + pace)
// the voice preview reflects. Face = the person, voice = the timbre, personality
// = temperament, intensity = pressure.
export interface PreviewReq {
  voiceId: string;
  faceId: string;
  personality: string;
  intensity: number;
}

export interface ProfileSlice {
  getConfig(): Promise<InterviewConfig>;
  saveConfig(cfg: InterviewConfig): Promise<InterviewConfig>;
  listVoices(): Promise<Voice[]>;
  listFaces(): Promise<Face[]>;
  listPersonalities(): Promise<PersonalityOption[]>;
  voicePreview(req: PreviewReq): Promise<Blob | null>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<Profile>;
  deleteAccount(): Promise<void>;
}

export const DEFAULT_CONFIG: InterviewConfig = { voice_id: "aoede", face_id: "sophia", personality: "neutral", intensity: 3 };

export const profileHttp: ProfileSlice = {
  getConfig() { return req<InterviewConfig>("/api/v1/config"); },
  saveConfig(cfg) { return req<InterviewConfig>("/api/v1/config", { method: "PUT", body: JSON.stringify(cfg) }); },
  listVoices() { return req<Voice[]>("/api/v1/voices"); },
  listFaces() { return req<Face[]>("/api/v1/faces"); },
  listPersonalities() { return req<PersonalityOption[]>("/api/v1/personalities"); },
  async voicePreview(req) {
    try {
      const qs = new URLSearchParams({
        voice: req.voiceId, face: req.faceId, personality: req.personality, intensity: String(req.intensity),
      }).toString();
      const res = await fetch(`${BASE}/api/v1/voices/preview?${qs}`, { headers: authHeader() });
      if (!res.ok) return null;
      return await res.blob();
    } catch { return null; }
  },
  getProfile() { return req<Profile>("/api/v1/profile"); },
  saveProfile(p) { return req<Profile>("/api/v1/profile", { method: "PUT", body: JSON.stringify(p) }); },
  deleteAccount() { return req<void>("/api/v1/account", { method: "DELETE" }); },
};

// ---- mock ----
const CFG_KEY = "mi_mock_cfg";
const PROFILE_KEY = "mi_mock_profile";

export const MOCK_VOICES: Voice[] = [
  { id: "aoede", label: "Aoede", gender: "female", sample: "Hi, I'm Aoede — I flew in from Lisbon this morning, running on three espressos and mild jet lag. Let's see what you've got." },
  { id: "kore", label: "Kore", gender: "female", sample: "Hey there, Kore here, dialing in from a very rainy Seattle. Fun fact: I have never lost a staring contest. Shall we begin?" },
  { id: "leda", label: "Leda", gender: "female", sample: "Hello! Leda, live from Buenos Aires. I promise to be tough but fair — okay, mostly fair. Ready when you are." },
  { id: "charon", label: "Charon", gender: "male", sample: "Hey, Charon speaking, straight out of Chicago. I like strong coffee and even stronger system designs. Let's dig in." },
  { id: "fenrir", label: "Fenrir", gender: "male", sample: "What's up — I'm Fenrir, Reykjavik born, which explains the cold takes. Don't worry, I only bite bad assumptions." },
  { id: "orus", label: "Orus", gender: "male", sample: "Greetings, Orus here from Bangalore. My hobbies include long walks and short feedback loops. Let's do this." },
];

export const MOCK_FACES: Face[] = [
  { id: "sophia", label: "Sophia", gltf: "/avatars/rpm-female.glb" },
  { id: "marcus", label: "Marcus", gltf: "/avatars/marcus.glb" },
  { id: "richard", label: "Richard", gltf: "/avatars/richard.glb" },
];

// Mirrors api/internal/persona.Personalities (client-facing fields) so the
// persona picker works offline. The backend is the single source in the live
// app; this only backstops NEXT_PUBLIC_MOCK=1.
export const MOCK_PERSONALITIES: PersonalityOption[] = [
  { id: "supportive", label: "Supportive", blurb: "Warm and encouraging; nudges you when you're stuck." },
  { id: "neutral", label: "Neutral", blurb: "Professional and even — a typical real interview." },
  { id: "interruptive", label: "Interruptive", blurb: "Probes hard and barges in on gaps, like a senior bar-raiser." },
  { id: "annoying", label: "Stress", blurb: "Deliberately terse and pressuring to test composure." },
];

export const profileMock: ProfileSlice = {
  async getConfig() {
    if (typeof window === "undefined") return DEFAULT_CONFIG;
    const raw = window.localStorage.getItem(CFG_KEY);
    return raw ? (JSON.parse(raw) as InterviewConfig) : DEFAULT_CONFIG;
  },
  async saveConfig(cfg) { window.localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); return cfg; },
  async listVoices() { return MOCK_VOICES; },
  async listFaces() { return MOCK_FACES; },
  async listPersonalities() { return MOCK_PERSONALITIES; },
  async voicePreview() { return null; }, // mock has no real TTS; UI falls back to browser speech
  async getProfile() {
    if (typeof window === "undefined") return {};
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as Profile) : {};
  },
  async saveProfile(p) { window.localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); return p; },
  async deleteAccount() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("mi_token");
      window.localStorage.removeItem("mi_user");
      window.localStorage.removeItem(PROFILE_KEY);
      window.localStorage.removeItem(CFG_KEY);
      window.localStorage.removeItem("mi_mock_resume");
    }
  },
};

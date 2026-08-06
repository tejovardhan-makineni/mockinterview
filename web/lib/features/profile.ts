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

export interface ProfileSlice {
  getConfig(): Promise<InterviewConfig>;
  saveConfig(cfg: InterviewConfig): Promise<InterviewConfig>;
  listVoices(): Promise<Voice[]>;
  listFaces(): Promise<Face[]>;
  voicePreview(voiceId: string): Promise<Blob | null>;
  getProfile(): Promise<Profile>;
  saveProfile(p: Profile): Promise<Profile>;
  deleteAccount(): Promise<void>;
}

export const DEFAULT_CONFIG: InterviewConfig = { voice_id: "aoede", face_id: "ava", personality: "neutral", intensity: 3 };

export const profileHttp: ProfileSlice = {
  getConfig() { return req<InterviewConfig>("/api/v1/config"); },
  saveConfig(cfg) { return req<InterviewConfig>("/api/v1/config", { method: "PUT", body: JSON.stringify(cfg) }); },
  listVoices() { return req<Voice[]>("/api/v1/voices"); },
  listFaces() { return req<Face[]>("/api/v1/faces"); },
  async voicePreview(voiceId) {
    try {
      const res = await fetch(`${BASE}/api/v1/voices/preview?voice=${encodeURIComponent(voiceId)}`, { headers: authHeader() });
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
  { id: "aoede", label: "Aoede", gender: "female" },
  { id: "kore", label: "Kore", gender: "female" },
  { id: "leda", label: "Leda", gender: "female" },
  { id: "charon", label: "Charon", gender: "male" },
  { id: "fenrir", label: "Fenrir", gender: "male" },
  { id: "orus", label: "Orus", gender: "male" },
];

export const MOCK_FACES: Face[] = [
  { id: "sophia", label: "Sophia — Realistic", gltf: "/avatars/rpm-female.glb" },
  { id: "ava", label: "Ava", gltf: "" },
  { id: "maya", label: "Maya", gltf: "" },
  { id: "leo", label: "Leo", gltf: "" },
  { id: "noah", label: "Noah", gltf: "" },
  { id: "pumpkin", label: "Pumpkin Professor", gltf: "" },
  { id: "robot", label: "Interviewer-9000 (Robot)", gltf: "" },
  { id: "wizard", label: "The Wizard", gltf: "" },
  { id: "alien", label: "Zorp (Alien)", gltf: "" },
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
  async voicePreview() { return null; },
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

// Localization feature slice — the offered UI/interview languages and the
// on-demand translator for app-owned English UI copy. Owns Language. Backend:
// api/internal/i18n (+ persona/languages.go). The full language list lives in
// the backend (persona.Languages); this slice mirrors it for offline/mock so
// NEXT_PUBLIC_MOCK=1 keeps working, and lib/i18n.tsx consumes it through the
// api composer instead of talking to fetch() directly.

import { req } from "../http";

// A locale the app UI + interviewer can run in. `code` is the stable id;
// `label` is the endonym (native name); `name` is the English name shown in the
// picker (and used by the backend for LLM prompts).
export interface Language {
  code: string;
  label: string;
  name: string;
}

export interface I18nSlice {
  // translate resolves each of `texts` into `lang`, returning a NEW array in the
  // same order (English is echoed back unchanged; failures fall back to the
  // source string). The server returns a source→translation map; we realign it
  // to the input order so callers never depend on the wire shape.
  translate(lang: string, texts: string[]): Promise<string[]>;
  listLanguages(): Promise<Language[]>;
}

// LANGUAGES mirrors the backend persona.Languages set so the picker + language
// validation work fully offline. It is the ONLY place the frontend spells the
// list out; lib/i18n.tsx imports it from here rather than re-declaring it.
export const LANGUAGES: Language[] = [
  { code: "en", label: "English", name: "English" },
  { code: "es", label: "Español", name: "Spanish" },
  { code: "fr", label: "Français", name: "French" },
  { code: "de", label: "Deutsch", name: "German" },
  { code: "pt", label: "Português", name: "Portuguese" },
  { code: "hi", label: "हिन्दी", name: "Hindi" },
  { code: "te", label: "తెలుగు", name: "Telugu" },
  { code: "zh", label: "中文", name: "Chinese" },
  { code: "ja", label: "日本語", name: "Japanese" },
  { code: "ar", label: "العربية", name: "Arabic" },
];

export const i18nHttp: I18nSlice = {
  async translate(lang, texts) {
    const data = await req<{ translations: Record<string, string> }>("/api/v1/i18n/translate", {
      method: "POST",
      body: JSON.stringify({ lang, texts }),
    });
    const tr = data.translations || {};
    return texts.map((t) => (tr[t] !== undefined && tr[t] !== "" ? tr[t] : t));
  },
  listLanguages() { return req<Language[]>("/api/v1/languages"); },
};

// ---- mock ----
export const i18nMock: I18nSlice = {
  // Offline: no translator, so echo the source strings back unchanged (the UI
  // simply stays in English).
  async translate(_lang, texts) { return texts; },
  async listLanguages() { return LANGUAGES; },
};

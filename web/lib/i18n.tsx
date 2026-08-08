"use client";

// App-wide localization. We translate ONLY app-owned English UI copy — every
// string passed through t() — into the selected language, on demand, via the
// backend LLM translator, and cache the result PERSISTENTLY in localStorage so a
// given (language, string) is fetched at most once per browser. User content
// (resume text, transcripts, job descriptions) is never sent here.
//
// Usage: `const t = useT();` then `t("Save profile")`. Unwrapped strings simply
// stay English — coverage can grow incrementally with no breakage. English is
// the source language, so t() is a no-op when the language is English.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { LANGUAGES, type Language } from "./features/i18n";

// The offered language set + translator both live in the lib/features/i18n slice
// (single source, backed by the backend /languages + /i18n/translate through the
// api composer). We re-export LANGUAGES for callers that import it from here.
export { LANGUAGES };
export type { Language };

// labelFor renders the picker option text: plain "English" for English, else
// "endonym (English name)" so it stays recoverable in any script.
export const labelFor = (l: Language) =>
  l.code === "en" ? l.label : `${l.label} (${l.name})`;
const CODES = new Set(LANGUAGES.map((l) => l.code));
export const isRTL = (code: string) => code === "ar";

type Dict = Record<string, string>;
const LS_LANG = "mi_lang";
const dictKey = (lang: string) => `mi_i18n_${lang}`;

// Module-level so every consumer shares one cache across mounts.
const dicts: Record<string, Dict> = {};
function dictFor(lang: string): Dict {
  if (dicts[lang]) return dicts[lang];
  let d: Dict = {};
  try { const raw = typeof localStorage !== "undefined" && localStorage.getItem(dictKey(lang)); if (raw) d = JSON.parse(raw); } catch { /* ignore */ }
  dicts[lang] = d;
  return d;
}
function persist(lang: string) {
  try { localStorage.setItem(dictKey(lang), JSON.stringify(dicts[lang] || {})); } catch { /* quota */ }
}

type Ctx = { lang: string; setLang: (l: string) => void; t: (s: string) => string; version: number; languages: Language[] };
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (s) => s, version: 0, languages: LANGUAGES });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer reads the saved language directly. First paint still renders
  // English (the translation dict is empty until fetched), so this cannot cause a
  // hydration mismatch — the DOM text matches the server either way.
  const [lang, setLangState] = useState<string>(() => {
    try { const s = localStorage.getItem(LS_LANG); if (s && CODES.has(s)) return s; } catch { /* ignore */ }
    return "en";
  });
  const [version, setVersion] = useState(0);
  // The picker's option set. Seeded from the static mirror (so the first paint
  // renders synchronously) and refreshed from the backend /languages catalog via
  // the api composer — the offered set is owned by the backend, not re-hardcoded.
  const [languages, setLanguages] = useState<Language[]>(LANGUAGES);
  const langRef = useRef(lang);
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<number | undefined>(undefined);

  // Reflect the language onto <html lang/dir> (DOM only — no setState here).
  useEffect(() => {
    langRef.current = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL(lang) ? "rtl" : "ltr";
  }, [lang]);

  // Load the offered languages from the backend catalog (mock returns the static
  // list offline). Best-effort: on failure the seeded static list stands.
  useEffect(() => {
    let live = true;
    api.listLanguages().then((ls) => { if (live && ls?.length) setLanguages(ls); }).catch(() => { /* keep static */ });
    return () => { live = false; };
  }, []);

  const flush = useCallback(async () => {
    const lg = langRef.current;
    if (lg === "en") { pending.current.clear(); return; }
    const d = dictFor(lg);
    const need = Array.from(pending.current).filter((s) => d[s] === undefined);
    pending.current.clear();
    if (!need.length) return;
    try {
      // Through the api composer (http hits /i18n/translate; the mock twin echoes
      // the input) so offline mode never breaks. `translate` returns translations
      // aligned to `need`'s order.
      const out = await api.translate(lg, need);
      need.forEach((s, i) => { d[s] = out[i] ?? s; });
      persist(lg);
      if (langRef.current === lg) setVersion((v) => v + 1); // re-render consumers with fresh dict
    } catch { /* offline — strings stay English */ }
  }, []);

  const t = useCallback((s: string) => {
    const lg = langRef.current;
    if (!s || lg === "en") return s;
    const d = dictFor(lg);
    if (d[s] !== undefined) return d[s] || s;
    pending.current.add(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 90); // batch a render's worth of strings into one request
    return s; // show English until the translation lands
  }, [flush]);

  const setLang = useCallback((l: string) => {
    if (!CODES.has(l)) l = "en";
    langRef.current = l;
    try { localStorage.setItem(LS_LANG, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
    document.documentElement.dir = isRTL(l) ? "rtl" : "ltr";
    setLangState(l);
    setVersion((v) => v + 1);
  }, []);

  return <I18nContext.Provider value={{ lang, setLang, t, version, languages }}>{children}</I18nContext.Provider>;
}

// useT returns the translate function; consumers re-render when new translations
// arrive (via the context value's version) and re-resolve their strings.
export function useT() {
  return useContext(I18nContext).t;
}

export function useLang() {
  const { lang, setLang, languages } = useContext(I18nContext);
  return { lang, setLang, languages };
}

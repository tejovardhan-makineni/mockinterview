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
import { BASE, authHeader } from "./http";

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
  { code: "ar", label: "العربية" },
];
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

type Ctx = { lang: string; setLang: (l: string) => void; t: (s: string) => string; version: number };
const I18nContext = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (s) => s, version: 0 });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer reads the saved language directly. First paint still renders
  // English (the translation dict is empty until fetched), so this cannot cause a
  // hydration mismatch — the DOM text matches the server either way.
  const [lang, setLangState] = useState<string>(() => {
    try { const s = localStorage.getItem(LS_LANG); if (s && CODES.has(s)) return s; } catch { /* ignore */ }
    return "en";
  });
  const [version, setVersion] = useState(0);
  const langRef = useRef(lang);
  const pending = useRef<Set<string>>(new Set());
  const timer = useRef<number | undefined>(undefined);

  // Reflect the language onto <html lang/dir> (DOM only — no setState here).
  useEffect(() => {
    langRef.current = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = isRTL(lang) ? "rtl" : "ltr";
  }, [lang]);

  const flush = useCallback(async () => {
    const lg = langRef.current;
    if (lg === "en") { pending.current.clear(); return; }
    const d = dictFor(lg);
    const need = Array.from(pending.current).filter((s) => d[s] === undefined);
    pending.current.clear();
    if (!need.length) return;
    try {
      const res = await fetch(`${BASE}/api/v1/i18n/translate`, {
        method: "POST",
        headers: { ...authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ lang: lg, texts: need }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { translations: Dict };
      Object.assign(d, data.translations || {});
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

  return <I18nContext.Provider value={{ lang, setLang, t, version }}>{children}</I18nContext.Provider>;
}

// useT returns the translate function; consumers re-render when new translations
// arrive (via the context value's version) and re-resolve their strings.
export function useT() {
  return useContext(I18nContext).t;
}

export function useLang() {
  const { lang, setLang } = useContext(I18nContext);
  return { lang, setLang };
}

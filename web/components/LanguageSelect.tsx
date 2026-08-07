"use client";

// Language picker. Two visual variants: "sidebar" (full-width, sits under its
// label in the app-shell footer so long "endonym (English)" values never spill
// past the nav edge) and "header" (compact, for the interview top bar). Changing
// it re-localizes the whole UI (and, for a newly started interview, the language
// the interviewer speaks).
import { LANGUAGES, labelFor, useLang } from "@/lib/i18n";

export function LanguageSelect({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  const { lang, setLang } = useLang();
  const sidebar = variant === "sidebar";
  const selectCls = sidebar
    ? "w-full min-w-0 flex-1 truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2 py-1.5 text-xs text-[var(--color-ink)] outline-none hover:bg-[var(--color-panel)] focus:border-[var(--color-accent)]"
    : "min-w-0 max-w-[180px] truncate rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 text-sm text-[var(--color-ink)] outline-none hover:bg-[var(--color-panel-2)] focus:border-[var(--color-accent)]";
  return (
    <label className={`flex ${sidebar ? "w-full" : ""} min-w-0 items-center gap-1.5`}>
      <span className="sr-only">Language</span>
      <span aria-hidden="true" className="shrink-0 text-sm">🌐</span>
      <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} className={selectCls}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{labelFor(l)}</option>
        ))}
      </select>
    </label>
  );
}

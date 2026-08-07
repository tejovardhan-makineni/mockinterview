"use client";

// Language picker. Two visual variants: "sidebar" (matches the theme row in the
// app shell footer) and "header" (compact, for the interview top bar). Changing
// it re-localizes the whole UI (and, for a newly started interview, the language
// the interviewer speaks).
import { LANGUAGES, labelFor, useLang } from "@/lib/i18n";

export function LanguageSelect({ variant = "sidebar" }: { variant?: "sidebar" | "header" }) {
  const { lang, setLang } = useLang();
  const cls =
    variant === "header"
      ? "rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] px-2.5 py-1.5 text-sm text-[var(--color-ink)] outline-none hover:bg-[var(--color-panel-2)] focus:border-[var(--color-accent)]"
      : "rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-2.5 py-1.5 text-xs text-[var(--color-ink)] outline-none hover:bg-[var(--color-panel)] focus:border-[var(--color-accent)]";
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">Language</span>
      <span aria-hidden="true" className="text-sm">🌐</span>
      <select aria-label="Language" value={lang} onChange={(e) => setLang(e.target.value)} className={cls}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{labelFor(l)}</option>
        ))}
      </select>
    </label>
  );
}

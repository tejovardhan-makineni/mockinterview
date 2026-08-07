"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

// A segmented control for the three themes (Dark / Light / Quantum): all options
// are visible at once and one click jumps straight to any of them — clearer than
// a blind cycle button. Persisted + applied via <html data-theme>.
type Theme = "dark" | "light" | "quantum";
const ORDER: Theme[] = ["dark", "light", "quantum"];
const ICON: Record<Theme, string> = { dark: "🌙", light: "☀️", quantum: "⚡" };
const LABEL: Record<Theme, string> = { dark: "Dark", light: "Light", quantum: "Quantum" };

export function ThemeToggle() {
  const tr = useT();
  // Read the stored theme in a lazy initializer (the layout's inline script has
  // already applied <html data-theme> before paint, so this just mirrors it).
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = typeof window !== "undefined" ? (localStorage.getItem("mi_theme") as Theme) : null;
    return stored && ORDER.includes(stored) ? stored : "dark";
  });

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);

  const select = (t: Theme) => {
    if (typeof window !== "undefined") localStorage.setItem("mi_theme", t);
    setTheme(t);
  };

  return (
    <div role="radiogroup" aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-0.5">
      {ORDER.map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            role="radio"
            aria-checked={active}
            title={tr(LABEL[t])}
            aria-label={tr(LABEL[t])}
            onClick={() => select(t)}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-sm transition ${
              active
                ? "bg-[var(--color-accent)] text-[#0b0d12] shadow-sm"
                : "text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-ink)]"
            }`}
          >
            <span aria-hidden="true">{ICON[t]}</span>
            {active && <span className="text-xs font-semibold">{tr(LABEL[t])}</span>}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

// Cycles the three themes: Dark → Light → Quantum. Persisted + applied via
// <html data-theme>. Same layout across all three.
type Theme = "dark" | "light" | "quantum";
const ORDER: Theme[] = ["dark", "light", "quantum"];
const ICON: Record<Theme, string> = { dark: "🌙", light: "☀️", quantum: "⚡" };
const LABEL: Record<Theme, string> = { dark: "Dark", light: "Light", quantum: "Quantum" };

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window !== "undefined" ? ((localStorage.getItem("mi_theme") as Theme) || "dark") : "dark"
  );
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); }, [theme]);
  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    if (typeof window !== "undefined") localStorage.setItem("mi_theme", next);
    setTheme(next);
  };
  return (
    <button onClick={cycle} title={`Theme: ${LABEL[theme]} (click to switch)`}
      className="flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-2.5 text-sm hover:bg-[var(--color-panel-2)]">
      <span>{ICON[theme]}</span>
      <span className="hidden text-xs text-[var(--color-muted)] sm:inline">{LABEL[theme]}</span>
    </button>
  );
}

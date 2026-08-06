"use client";

import { useState } from "react";

// A small ⓘ that reveals an explanation (what we measured + how to improve).
export function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        aria-label="More info"
        className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--color-faint)] text-[10px] leading-none text-[var(--color-faint)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
      >
        i
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 z-50 mb-2 w-60 -translate-x-1/2 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] p-3 text-left text-xs font-normal leading-relaxed text-[var(--color-muted)] shadow-2xl">
          {text}
        </span>
      )}
    </span>
  );
}

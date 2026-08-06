"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

// Avatar chip in the top-right that opens a menu: Settings / Sign out.
export function ProfileMenu({ email }: { email?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (email?.[0] ?? "?").toUpperCase();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-full border border-[var(--color-line)] py-1 pl-1 pr-3 hover:bg-[var(--color-panel-2)]">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-accent)] text-sm font-bold text-[#0b0d12]">{initial}</span>
        <span className="max-w-[160px] truncate text-sm text-[var(--color-muted)]">{email ?? "Account"}</span>
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] shadow-2xl">
          <Link href="/settings" className="block px-4 py-2.5 text-sm hover:bg-[var(--color-panel-2)]">⚙️ Settings</Link>
          <Link href="/resume-review" className="block px-4 py-2.5 text-sm hover:bg-[var(--color-panel-2)]">📄 Resume review</Link>
          <button onClick={() => { api.logout(); router.replace("/login"); }} className="block w-full px-4 py-2.5 text-left text-sm text-[var(--color-bad)] hover:bg-[var(--color-panel-2)]">Sign out</button>
        </div>
      )}
    </div>
  );
}

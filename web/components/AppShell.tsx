"use client";

// The app shell: a fixed left sidebar (Dashboard / Interview / Resume / Results
// / Settings, with sign-out bottom-left) + an ambient-glass main area. Every
// signed-in page renders its content inside <AppShell>. Matches the Quantum
// design; adapts to Light/Dark themes via CSS vars.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";

export type NavKey = "dashboard" | "interview" | "resume" | "results" | "settings";

const NAV: { key: NavKey; href: string; label: string; icon: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", icon: "📊" },
  { key: "interview", href: "/interviews", label: "Interview", icon: "🎤" },
  { key: "resume", href: "/resume-review", label: "Resume", icon: "📄" },
  { key: "results", href: "/results", label: "Results", icon: "📈" },
  { key: "settings", href: "/settings", label: "Settings", icon: "⚙️" },
];

export function AppShell({ active, children }: { active: NavKey; children: ReactNode }) {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false); // mobile drawer

  useEffect(() => { api.me().then((u) => setEmail(u?.email ?? "")); }, []);

  const NavLinks = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((n) => (
        <Link key={n.key} href={n.href} onClick={() => setOpen(false)}
          className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition ${
            active === n.key
              ? "border-l-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] font-semibold text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
          }`}>
          <span className="text-base">{n.icon}</span>
          <span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );

  const Sidebar = (
    <div className="flex h-full flex-col gap-2 px-4 py-6">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-2 text-lg font-bold tracking-tight">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--color-accent)] text-sm font-extrabold text-[var(--color-studio)]">m</span>
        mockinterview<span className="text-[var(--color-accent)]">.live</span>
      </Link>
      {NavLinks}
      <div className="mt-2 flex items-center justify-between border-t border-[var(--color-line)] pt-4">
        <div className="min-w-0">
          <div className="truncate text-xs text-[var(--color-muted)]">{email || "Account"}</div>
        </div>
        <ThemeToggle />
      </div>
      <button onClick={() => { api.logout(); router.replace("/login"); }}
        className="mt-1 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm text-[var(--color-bad)] hover:bg-[var(--color-panel-2)]">
        <span>↩</span> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 z-40 hidden h-full w-[264px] border-r border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-studio)_82%,transparent)] backdrop-blur-xl md:block">
        {Sidebar}
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="sticky top-0 z-40 flex items-center justify-between border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-studio)_88%,transparent)] px-4 py-3 backdrop-blur md:hidden">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--color-accent)] text-sm font-extrabold text-[var(--color-studio)]">m</span>
          mockinterview<span className="text-[var(--color-accent)]">.live</span>
        </Link>
        <button onClick={() => setOpen(!open)} className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm">☰</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute left-0 top-0 h-full w-[264px] border-r border-[var(--color-line)] bg-[var(--color-studio)]" onClick={(e) => e.stopPropagation()}>
            {Sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="md:ml-[264px]">
        <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">{children}</div>
      </main>
    </div>
  );
}

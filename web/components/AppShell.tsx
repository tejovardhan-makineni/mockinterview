"use client";

// The app shell: a fixed left sidebar (Dashboard / Interview / Resume / Results
// / Settings, with sign-out bottom-left) + an ambient-glass main area. Every
// signed-in page renders its content inside <AppShell>. Matches the Quantum
// design; adapts to Light/Dark themes via CSS vars.
import { useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelect } from "./LanguageSelect";
import { useT } from "@/lib/i18n";
import {
  IconDashboard, IconInterview, IconPacks, IconResume, IconResults, IconSettings, IconSignOut, LogoM,
} from "@/components/icons";

export type NavKey = "dashboard" | "interview" | "packs" | "resume" | "results" | "settings";

type IconType = ComponentType<{ className?: string }>;

const NAV: { key: NavKey; href: string; label: string; Icon: IconType }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard", Icon: IconDashboard },
  { key: "interview", href: "/interviews", label: "Interview", Icon: IconInterview },
  { key: "packs", href: "/packs", label: "Practice Packs", Icon: IconPacks },
  { key: "resume", href: "/resume-review", label: "Resume", Icon: IconResume },
  { key: "results", href: "/results", label: "Results", Icon: IconResults },
  { key: "settings", href: "/settings", label: "Settings", Icon: IconSettings },
];

export function AppShell({ active, children }: { active: NavKey; children: ReactNode }) {
  const router = useRouter();
  const t = useT();
  const [email, setEmail] = useState<string>("");
  const [open, setOpen] = useState(false); // mobile drawer
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await api.me();
      if (!alive) return;
      setEmail(u?.email ?? "");
      if (!u) return;
      // Mandatory onboarding gate: a signed-in user with no professions chosen is
      // routed to the picker before using the app (so the catalog is always gated).
      const p = await api.getProfile();
      if (!alive) return;
      if (!p?.professions || p.professions.length === 0) router.replace("/onboarding");
    })();
    return () => { alive = false; };
  }, [router]);

  // Drawer a11y: close on Escape and move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    drawerRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const NavLinks = (
    <nav className="flex flex-1 flex-col gap-1">
      {NAV.map((n) => {
        const { Icon } = n;
        return (
          <Link key={n.key} href={n.href} onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm transition ${
              active === n.key
                ? "border-l-2 border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] font-semibold text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-ink)]"
            }`}>
            <Icon className="h-5 w-5" />
            <span>{t(n.label)}</span>
          </Link>
        );
      })}
    </nav>
  );

  const Sidebar = (
    <div className="flex h-full flex-col gap-2 px-4 py-6">
      <Link href="/dashboard" className="mb-6 flex items-center gap-2.5 px-2 text-lg font-bold tracking-tight">
        <LogoM className="h-8 w-8" />
        mockinterview<span className="text-[var(--color-accent)]">.live</span>
      </Link>
      {NavLinks}
      <div className="mt-2 space-y-2 border-t border-[var(--color-line)] pt-4">
        {/* Language selector — stacked (full-width select under the label) so long
            "endonym (English)" values never overflow the sidebar. */}
        <div className="px-1">
          <span className="text-xs font-medium text-[var(--color-muted)]">{t("Language")}</span>
          <div className="mt-1"><LanguageSelect variant="sidebar" /></div>
        </div>
        {/* Theme switcher — its own labeled row above the account info. */}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-medium text-[var(--color-muted)]">{t("Theme")}</span>
          <ThemeToggle />
        </div>
        {/* Account email */}
        <div className="min-w-0 px-1">
          <div className="truncate text-xs text-[var(--color-muted)]" title={email || "Account"}>{email || "Account"}</div>
        </div>
        {/* Sign out — full-width bordered button, clearly separated. */}
        <button onClick={() => { api.logout(); router.replace("/login"); }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-line)] px-4 py-2.5 text-sm font-medium text-[var(--color-bad)] transition hover:border-[var(--color-bad)] hover:bg-[color-mix(in_srgb,var(--color-bad)_10%,transparent)]">
          <IconSignOut className="h-4 w-4" />
          {t("Sign out")}
        </button>
      </div>
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
          <LogoM className="h-7 w-7" />
          mockinterview<span className="text-[var(--color-accent)]">.live</span>
        </Link>
        <button onClick={() => setOpen(!open)} aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav-drawer" className="rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm">☰</button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div ref={drawerRef} id="mobile-nav-drawer" role="dialog" aria-modal="true" aria-label="Navigation menu" tabIndex={-1} className="absolute left-0 top-0 h-full w-[264px] border-r border-[var(--color-line)] bg-[var(--color-studio)] outline-none" onClick={(e) => e.stopPropagation()}>
            {Sidebar}
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="md:ml-[264px]">
        <div className="w-full px-6 py-8 lg:px-10">{children}</div>
      </main>
    </div>
  );
}

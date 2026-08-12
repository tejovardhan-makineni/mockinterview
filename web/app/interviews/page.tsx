"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { matchScore } from "@/lib/features/catalog";
import type { QuestionSummary } from "@/lib/features/catalog";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { useT } from "@/lib/i18n";

const DIFF_TONE = { junior: "good", entry: "good", mid: "accent", senior: "warn", staff: "bad" } as const;
const MODALITY_LABEL: Record<string, string> = { system_design: "🧩 Whiteboard", coding: "⌨️ Coding (doc)", written: "📝 Written", conversational: "🎙️ Spoken" };
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// Typical length per modality (users can change it on the start screen).
const estMinutes = (m: string) => (m === "conversational" ? 18 : m === "written" ? 22 : 30);

const FILTER_KEY = "mi_catalog_filters";

export default function InterviewsPage() {
  const t = useT();
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [professions, setProfessions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [area, setArea] = useState("all");
  const [domain, setDomain] = useState("all");
  const [query, setQuery] = useState("");
  const [recommended, setRecommended] = useState("");

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [qs, p] = await Promise.all([api.listQuestions(), api.getProfile()]);
      setQuestions(qs);
      const profs = (p as Profile)?.professions ?? [];
      setProfessions(profs);
      // Restore saved filters; else default to the profile's domain if it exists in the corpus.
      // An area is only honoured if it's one of the user's professions (the gate).
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(FILTER_KEY) : null;
      if (saved) {
        const f = JSON.parse(saved) as { area?: string; domain?: string; query?: string };
        setArea(f.area && profs.includes(f.area) ? f.area : "all"); setDomain(f.domain ?? "all"); setQuery(f.query ?? "");
      } else if ((p as Profile)?.domain && qs.some((q) => q.domain === (p as Profile).domain)) {
        setDomain((p as Profile).domain!);
      }
      if ((p as Profile)?.domain) setRecommended((p as Profile).domain!);
      setLoading(false);
    })();
  }, [router]);

  // Persist filters for next visit.
  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(FILTER_KEY, JSON.stringify({ area, domain, query }));
  }, [area, domain, query, loading]);

  // GATING: the catalog only ever shows questions whose `areas` intersect the
  // user's professions — even with no filters, a software user never sees law.
  // If the user has no professions set, the gated set is empty (the AppShell
  // onboarding gate redirects them; this is the defensive fallback).
  const profSet = useMemo(() => new Set(professions), [professions]);
  const gated = useMemo(
    () => (profSet.size === 0 ? [] : questions.filter((q) => (q.areas ?? []).some((a) => profSet.has(a)))),
    [questions, profSet]
  );

  // Area options = the user's professions, intersected with areas actually
  // present in the corpus (so we never offer an empty area).
  const areas = useMemo(
    () => professions.filter((a) => questions.some((q) => (q.areas ?? []).includes(a))).sort(),
    [professions, questions]
  );

  // Domains (sub-topics) available under the selected area — within the gated set.
  const domains = useMemo(
    () => Array.from(new Set(
      gated.filter((q) => area === "all" || (q.areas ?? []).includes(area)).map((q) => q.domain)
    )).sort(),
    [gated, area]
  );

  // Selecting an area narrows the domain options; if the current domain isn't in
  // that area, fall back to "all" so the selection stays coherent.
  const onArea = (a: string) => {
    setArea(a);
    if (a !== "all" && domain !== "all") {
      const inArea = gated.some((q) => q.domain === domain && (q.areas ?? []).includes(a));
      if (!inArea) setDomain("all");
    }
  };

  const filtered = useMemo(() => {
    return gated
      .filter((q) => (area === "all" || (q.areas ?? []).includes(area)) && (domain === "all" || q.domain === domain))
      .map((q) => ({ q, score: matchScore(q, query) }))
      .filter((x) => x.score > 0.34)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);
  }, [gated, area, domain, query]);

  const clear = () => { setArea("all"); setDomain("all"); setQuery(""); };
  const hasFilters = area !== "all" || domain !== "all" || query.trim() !== "";

  // Pick a random interview from the CURRENT filtered set, so the active
  // area/domain/search filters are honoured. Math.random in a click handler is
  // safe for static export (no render-time nondeterminism / hydration mismatch).
  const pickRandom = () => {
    if (filtered.length === 0) return;
    const q = filtered[Math.floor(Math.random() * filtered.length)];
    router.push(`/setup?q=${q.id}`);
  };

  // appearance-none drops the native arrow (which crams against the pill's
  // rounded right edge); Select renders a chevron inset from the edge instead.
  const selectCls =
    "appearance-none rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] pl-3.5 pr-8 py-1.5 text-sm text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]";

  return (
    <AppShell active="interview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("Interview Catalog")}</h1>
          <p className="mt-1 text-[var(--color-muted)]">{t("Pick an area and a domain — tailored to the professions you interview for.")} {gated.length} {t("interviews across")} {areas.length} {t("areas.")}</p>
        </div>
        {recommended && gated.some((q) => q.domain === recommended) && <Badge tone="accent">{t("Recommended:")} {pretty(recommended)}</Badge>}
      </div>

      {/* Search + Area/Domain selects */}
      <div className="mt-6 flex flex-col gap-3">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={t("🔍 Search — e.g. 'rate limiting', 'kafka', 'ownership', 'chest pain'…")}
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-[var(--color-faint)]">{t("Area")}</span>
            <span className="relative inline-flex items-center">
              <select value={area} onChange={(e) => onArea(e.target.value)} className={selectCls}>
                <option value="all">{t("All areas")}</option>
                {areas.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}
              </select>
              <Chevron />
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-[var(--color-faint)]">{t("Domain")}</span>
            <span className="relative inline-flex items-center">
              <select value={domain} onChange={(e) => setDomain(e.target.value)} className={selectCls}>
                <option value="all">{t("All domains")}</option>
                {domains.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
              </select>
              <Chevron />
            </span>
          </label>
          <button
            onClick={pickRandom}
            disabled={filtered.length === 0}
            title={t("Start a random interview from the filtered results")}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] px-3.5 py-1.5 text-sm text-[var(--color-ink)] transition hover:border-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("🎲 Surprise me")}
          </button>
          {hasFilters && <button onClick={clear} className="text-sm text-[var(--color-accent)] hover:brightness-125">{t("Clear filters")}</button>}
          <span className="ml-auto text-xs text-[var(--color-faint)]">{filtered.length} {t("shown")}</span>
        </div>
      </div>

      {loading ? (
        <p className="mt-10 text-[var(--color-muted)]">{t("Loading…")}</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((q) => (
            <Panel key={q.id} className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                {/* Catalog title/blurb + known metadata stay in English (our data). */}
                <h3 className="text-base font-semibold leading-snug">{q.title}</h3>
                <Badge tone={DIFF_TONE[q.difficulty] ?? "muted"}>{q.difficulty}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-[var(--color-panel-2)] px-2 py-0.5 text-xs text-[var(--color-ink)]">{MODALITY_LABEL[q.modality] ?? q.modality}</span>
                <span className="rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-muted)]">{pretty(q.domain)}</span>
                <span className="rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-faint)]">⏱ ~{estMinutes(q.modality)} {t("minutes")}</span>
              </div>
              <p className="mt-2 flex-1 text-sm text-[var(--color-muted)]">{q.blurb}</p>
              <Button href={`/setup?q=${q.id}`} className="mt-4 self-start">{t("Start →")}</Button>
            </Panel>
          ))}
          {filtered.length === 0 && (professions.length === 0
            ? <Panel className="col-span-full p-10 text-center text-[var(--color-muted)]">{t("Choose the professions you interview for to see your catalog.")} <Button href="/onboarding" className="mt-4">{t("Choose professions")}</Button></Panel>
            : <Panel className="col-span-full p-10 text-center text-[var(--color-muted)]">{t("No interviews match.")} <button onClick={clear} className="text-[var(--color-accent)]">{t("Clear filters")}</button></Panel>)}
        </div>
      )}
    </AppShell>
  );
}

// Chevron is the custom dropdown arrow for the Area/Domain pills — positioned
// inset from the rounded right edge (with pointer-events-none so clicks fall
// through to the underlying <select>).
function Chevron() {
  return (
    <svg
      aria-hidden viewBox="0 0 12 8"
      className="pointer-events-none absolute right-3 h-2 w-3 text-[var(--color-faint)]"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M1 1.5L6 6.5L11 1.5" />
    </svg>
  );
}

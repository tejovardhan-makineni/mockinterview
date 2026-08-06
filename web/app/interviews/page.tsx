"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import { matchScore } from "@/lib/features/catalog";
import type { QuestionSummary } from "@/lib/features/catalog";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";

const DIFF_TONE = { junior: "good", entry: "good", mid: "accent", senior: "warn", staff: "bad" } as const;
const MODALITY_LABEL: Record<string, string> = { system_design: "🧩 Whiteboard", coding: "⌨️ Coding (doc)", written: "📝 Written", conversational: "🎙️ Spoken" };
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const FILTER_KEY = "mi_catalog_filters";

export default function InterviewsPage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
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
      // Restore saved filters; else default to the profile's domain if it exists in the corpus.
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(FILTER_KEY) : null;
      if (saved) {
        const f = JSON.parse(saved) as { area?: string; domain?: string; query?: string };
        setArea(f.area ?? "all"); setDomain(f.domain ?? "all"); setQuery(f.query ?? "");
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

  // Areas (professions) present in the corpus — derived, not hardcoded.
  const areas = useMemo(
    () => Array.from(new Set(questions.flatMap((q) => q.areas ?? []))).sort(),
    [questions]
  );

  // Domains (sub-topics) available under the selected area — filtered to that area.
  const domains = useMemo(
    () => Array.from(new Set(
      questions.filter((q) => area === "all" || (q.areas ?? []).includes(area)).map((q) => q.domain)
    )).sort(),
    [questions, area]
  );

  // Selecting an area narrows the domain options; if the current domain isn't in
  // that area, fall back to "all" so the selection stays coherent.
  const onArea = (a: string) => {
    setArea(a);
    if (a !== "all" && domain !== "all") {
      const inArea = questions.some((q) => q.domain === domain && (q.areas ?? []).includes(a));
      if (!inArea) setDomain("all");
    }
  };

  const filtered = useMemo(() => {
    return questions
      .filter((q) => (area === "all" || (q.areas ?? []).includes(area)) && (domain === "all" || q.domain === domain))
      .map((q) => ({ q, score: matchScore(q, query) }))
      .filter((x) => x.score > 0.34)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);
  }, [questions, area, domain, query]);

  const clear = () => { setArea("all"); setDomain("all"); setQuery(""); };
  const hasFilters = area !== "all" || domain !== "all" || query.trim() !== "";

  const selectCls = "rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-1.5 text-sm text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]";

  return (
    <AppShell active="interview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Interview Catalog</h1>
          <p className="mt-1 text-[var(--color-muted)]">Pick an area and a domain — system design, LLD/OOD, coding, clinical, legal, case, and more. {questions.length} interviews across {areas.length} areas.</p>
        </div>
        {recommended && questions.some((q) => q.domain === recommended) && <Badge tone="accent">Recommended: {pretty(recommended)}</Badge>}
      </div>

      {/* Search + Area/Domain selects */}
      <div className="mt-6 flex flex-col gap-3">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search — e.g. 'rate limiting', 'kafka', 'ownership', 'chest pain'…"
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-[var(--color-faint)]">Area</span>
            <select value={area} onChange={(e) => onArea(e.target.value)} className={selectCls}>
              <option value="all">All areas</option>
              {areas.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <span className="text-[var(--color-faint)]">Domain</span>
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className={selectCls}>
              <option value="all">All domains</option>
              {domains.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
            </select>
          </label>
          {hasFilters && <button onClick={clear} className="text-sm text-[var(--color-accent)] hover:brightness-125">Clear filters</button>}
          <span className="ml-auto text-xs text-[var(--color-faint)]">{filtered.length} shown</span>
        </div>
      </div>

      {loading ? (
        <p className="mt-10 text-[var(--color-muted)]">Loading…</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((q) => (
            <Panel key={q.id} className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold leading-snug">{q.title}</h3>
                <Badge tone={DIFF_TONE[q.difficulty] ?? "muted"}>{q.difficulty}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="rounded-md bg-[var(--color-panel-2)] px-2 py-0.5 text-xs text-[var(--color-ink)]">{MODALITY_LABEL[q.modality] ?? q.modality}</span>
                <span className="rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-muted)]">{pretty(q.domain)}</span>
              </div>
              <p className="mt-2 flex-1 text-sm text-[var(--color-muted)]">{q.blurb}</p>
              <Button href={`/setup?q=${q.id}`} className="mt-4 self-start">Start →</Button>
            </Panel>
          ))}
          {filtered.length === 0 && <Panel className="col-span-full p-10 text-center text-[var(--color-muted)]">No interviews match. <button onClick={clear} className="text-[var(--color-accent)]">Clear filters</button></Panel>}
        </div>
      )}
    </AppShell>
  );
}

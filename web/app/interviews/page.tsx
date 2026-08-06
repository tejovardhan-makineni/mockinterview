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
  const [track, setTrack] = useState<"all" | "engineering" | "professional">("all");
  const [domain, setDomain] = useState("all");
  const [query, setQuery] = useState("");
  const [recommended, setRecommended] = useState("");

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [qs, p] = await Promise.all([api.listQuestions(), api.getProfile()]);
      setQuestions(qs);
      // Restore saved filters; else default to the profile domain.
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(FILTER_KEY) : null;
      if (saved) {
        const f = JSON.parse(saved) as { track?: typeof track; domain?: string; query?: string };
        setTrack(f.track ?? "all"); setDomain(f.domain ?? "all"); setQuery(f.query ?? "");
      } else if ((p as Profile)?.domain && qs.some((q) => q.domain === (p as Profile).domain)) {
        setDomain((p as Profile).domain!);
        setTrack(qs.find((q) => q.domain === (p as Profile).domain)?.track === "professional" ? "professional" : "engineering");
      }
      if ((p as Profile)?.domain) setRecommended((p as Profile).domain!);
      setLoading(false);
    })();
  }, [router]);

  // Persist filters for next visit.
  useEffect(() => {
    if (loading) return;
    window.localStorage.setItem(FILTER_KEY, JSON.stringify({ track, domain, query }));
  }, [track, domain, query, loading]);

  const domains = useMemo(
    () => Array.from(new Set(questions.filter((q) => track === "all" || q.track === track).map((q) => q.domain))).sort(),
    [questions, track]
  );

  const filtered = useMemo(() => {
    return questions
      .filter((q) => (track === "all" || q.track === track) && (domain === "all" || q.domain === domain))
      .map((q) => ({ q, score: matchScore(q, query) }))
      .filter((x) => x.score > 0.34)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.q);
  }, [questions, track, domain, query]);

  const clear = () => { setTrack("all"); setDomain("all"); setQuery(""); };
  const hasFilters = track !== "all" || domain !== "all" || query.trim() !== "";

  return (
    <AppShell active="interview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Interview Catalog</h1>
          <p className="mt-1 text-[var(--color-muted)]">System design, LLD/OOD, coding (doc-style), and spoken/written professional interviews — {questions.length} to choose from.</p>
        </div>
        {recommended && <Badge tone="accent">Recommended: {pretty(recommended)}</Badge>}
      </div>

      {/* Search + filters */}
      <div className="mt-6 flex flex-col gap-3">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 Search — e.g. 'rate limiting', 'kafka', 'ownership', 'chest pain'…"
          className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
        />
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "engineering", "professional"] as const).map((t) => (
            <button key={t} onClick={() => { setTrack(t); setDomain("all"); }}
              className={`rounded-full border px-3.5 py-1.5 text-sm transition ${track === t ? "border-[var(--color-accent)] bg-[var(--color-panel-2)] text-[var(--color-ink)]" : "border-[var(--color-line)] text-[var(--color-muted)] hover:bg-[var(--color-panel-2)]"}`}>
              {t === "all" ? "All tracks" : pretty(t)}
            </button>
          ))}
          {domains.length > 1 && (
            <select value={domain} onChange={(e) => setDomain(e.target.value)} className="rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-1.5 text-sm text-[var(--color-muted)]">
              <option value="all">All domains</option>
              {domains.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
            </select>
          )}
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

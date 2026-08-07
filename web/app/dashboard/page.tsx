"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SessionHistoryItem } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { Radar } from "@/components/Radar";
import { Achievements } from "@/components/Achievements";
import { computeAchievements, type QuestionMeta } from "@/lib/features/achievements";

const MOD_LABEL: Record<string, string> = { system_design: "Whiteboard", coding: "Coding", written: "Written", conversational: "Spoken" };
const tone = (s: number) => (s >= 3 ? "good" : s >= 2 ? "warn" : "bad");
const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function DashboardPage() {
  const router = useRouter();
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [metaByQid, setMetaByQid] = useState<Record<string, QuestionMeta>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      // Sessions drive the stats; the catalog supplies domain/areas per question
      // so achievements can count behavioral stations and distinct fields.
      const [sessions, questions] = await Promise.all([
        api.listSessions().catch(() => [] as SessionHistoryItem[]),
        api.listQuestions().catch(() => []),
      ]);
      setItems(sessions);
      setMetaByQid(Object.fromEntries(questions.map((q) => [q.id, { domain: q.domain, areas: q.areas ?? [] }])));
      setLoading(false);
    })();
  }, [router]);

  const achievements = useMemo(() => computeAchievements(items, metaByQid), [items, metaByQid]);

  const scored = useMemo(() => items.filter((i) => i.status === "complete" && i.scored !== false && typeof i.overall === "number"), [items]);
  const avg = scored.length ? scored.reduce((s, i) => s + (i.overall ?? 0), 0) / scored.length : 0;
  const best = scored.reduce((m, i) => Math.max(m, i.overall ?? 0), 0);

  // Skill radar + strong/weak by modality (avg overall per modality).
  const byMod = useMemo(() => {
    const m: Record<string, { sum: number; n: number }> = {};
    for (const i of scored) { const k = i.modality; (m[k] ??= { sum: 0, n: 0 }); m[k].sum += i.overall ?? 0; m[k].n++; }
    return Object.entries(m).map(([k, v]) => ({ modality: k, avg: v.sum / v.n })).sort((a, b) => b.avg - a.avg);
  }, [scored]);

  const recent = items.slice(0, 6);

  return (
    <AppShell active="dashboard">
      <h1 className="text-3xl font-extrabold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-[var(--color-muted)]">Your progress across interviews — scores, strengths, and where to focus.</p>

      {loading ? (
        <p className="mt-10 text-[var(--color-muted)]">Loading…</p>
      ) : items.length === 0 ? (
        <Panel className="mt-8 p-10 text-center">
          <p className="text-[var(--color-muted)]">No interviews yet — take your first one to start tracking progress.</p>
          <Button href="/interviews" className="mt-4">Browse interviews →</Button>
        </Panel>
      ) : (
        <>
          {/* Stat tiles */}
          <div className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Interviews" value={String(items.length)} />
            <Stat label="Completed" value={String(items.filter((i) => i.status === "complete").length)} />
            <Stat label="Avg score" value={scored.length ? `${avg.toFixed(1)}/4` : "—"} tone={scored.length ? tone(avg) : undefined} />
            <Stat label="Best score" value={scored.length ? `${best.toFixed(1)}/4` : "—"} tone={scored.length ? tone(best) : undefined} />
          </div>

          {/* Gamification — streak + achievement badges */}
          <Achievements streak={achievements.streak} badges={achievements.badges} earnedCount={achievements.earnedCount} />

          <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            {/* Recent sessions */}
            <Panel className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Recent sessions</h2>
                <Button href="/results" variant="ghost">All results →</Button>
              </div>
              <div className="space-y-2">
                {recent.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-line)] p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{it.title}</div>
                      <div className="text-xs text-[var(--color-faint)]">{new Date(it.created_at).toLocaleDateString()} · {MOD_LABEL[it.modality] ?? it.modality} · {it.status}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {it.status === "complete" && it.scored === false && <Badge tone="warn">n/a</Badge>}
                      {it.status === "complete" && it.scored !== false && typeof it.overall === "number" && <Badge tone={tone(it.overall)}>{it.overall.toFixed(1)}</Badge>}
                      <Button href={it.status === "complete" ? `/report?s=${it.id}` : `/interview?s=${it.id}`} variant="ghost">{it.status === "complete" ? "View" : "Resume"}</Button>
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* Skill radar */}
            <Panel className="flex flex-col p-5">
              <h2 className="mb-2 font-semibold">Skill radar</h2>
              {byMod.length >= 3
                ? (
                  <div className="flex min-h-[240px] flex-1 items-center justify-center">
                    <Radar data={byMod.map((m) => ({ label: MOD_LABEL[m.modality] ?? m.modality, value: m.avg }))} size={280} fill />
                  </div>
                )
                : <p className="flex flex-1 items-center justify-center py-10 text-center text-sm text-[var(--color-faint)]">Complete interviews in 3+ formats to see your skill radar.</p>}
            </Panel>
          </div>

          {/* Strong / weak — split the ranked list so an area never appears in
              both columns (top half = strong, bottom half = to prepare). */}
          {byMod.length > 0 && (() => {
            const mid = Math.ceil(byMod.length / 2);
            const strong = byMod.slice(0, Math.min(mid, 3));
            const weak = byMod.slice(mid).slice(0, 3); // the lower-ranked half, no overlap
            const Row = (m: { modality: string; avg: number }) => (
              <li key={m.modality} className="flex justify-between"><span className="text-[var(--color-muted)]">{MOD_LABEL[m.modality] ?? m.modality}</span><span className="font-mono">{m.avg.toFixed(1)}/4</span></li>
            );
            return (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Panel className="p-5">
                  <h2 className="mb-3 font-semibold"><Badge tone="good">Strong areas</Badge></h2>
                  <ul className="space-y-2 text-sm">{strong.map(Row)}</ul>
                </Panel>
                <Panel className="p-5">
                  <h2 className="mb-3 font-semibold"><Badge tone="warn">To prepare</Badge></h2>
                  {weak.length > 0
                    ? <ul className="space-y-2 text-sm">{weak.map(Row)}</ul>
                    : <p className="text-sm text-[var(--color-muted)]">Take interviews in more formats to see where to focus.</p>}
                  <Button href="/interviews" className="mt-4">Practice interview →</Button>
                </Panel>
              </div>
            );
          })()}
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "var(--color-good)" : tone === "warn" ? "var(--color-warn)" : tone === "bad" ? "var(--color-bad)" : "var(--color-ink)";
  return (
    <Panel className="p-4">
      <div className="text-3xl font-extrabold" style={{ color }}>{value}</div>
      <div className="mt-1 text-xs text-[var(--color-faint)]">{label}</div>
    </Panel>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SessionHistoryItem, User } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";

const MOD_LABEL: Record<string, string> = { system_design: "🧩 Whiteboard", coding: "⌨️ Coding", written: "📝 Written", conversational: "🎙️ Spoken" };
const tone = (s?: number) => (s === undefined ? "muted" : s >= 3 ? "good" : s >= 2 ? "warn" : "bad");

export default function ResultsPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      setUser(u);
      try { setItems(await api.listSessions()); } catch { /* ignore */ }
      setLoading(false);
    })();
  }, [router]);

  void user;
  return (
    <AppShell active="results">
      <h1 className="text-3xl font-extrabold tracking-tight">Your interviews</h1>
      <p className="mt-1 text-[var(--color-muted)]">Every interview you&apos;ve taken — open any to review the scorecard and coaching.</p>

      {loading ? (
        <p className="mt-8 text-[var(--color-muted)]">Loading…</p>
      ) : items.length === 0 ? (
        <Panel className="mt-8 p-10 text-center text-[var(--color-muted)]">
          No interviews yet. <Button href="/dashboard" className="ml-2">Start one →</Button>
        </Panel>
      ) : (
        <div className="mt-6 space-y-3">
          {items.map((it) => {
            const done = it.status === "complete";
            return (
              <Panel key={it.id} className="flex items-center justify-between p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{it.title}</span>
                    <span className="shrink-0 rounded-md bg-[var(--color-panel-2)] px-2 py-0.5 text-xs text-[var(--color-faint)]">{MOD_LABEL[it.modality] ?? it.modality}</span>
                  </div>
                  <div className="mt-1 text-xs text-[var(--color-faint)]">{new Date(it.created_at).toLocaleString()} · {it.status}</div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {done && it.scored === false && <Badge tone="warn">not scored</Badge>}
                  {done && it.scored !== false && it.overall !== undefined && <Badge tone={tone(it.overall)}>{it.overall.toFixed(1)} / 4</Badge>}
                  {done
                    ? <Button href={`/report?s=${it.id}`} variant="ghost">View report →</Button>
                    : <Button href={`/interview?s=${it.id}`} variant="ghost">Resume →</Button>}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}

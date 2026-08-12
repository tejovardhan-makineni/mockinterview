"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import type { Pack, PackDetail, PackProgress, PackRoundStatus } from "@/lib/features/packs";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { useLang, useT } from "@/lib/i18n";

const pretty = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const STATUS_TONE: Record<PackRoundStatus, "muted" | "accent" | "good"> = { not_started: "muted", in_progress: "accent", done: "good" };
const STATUS_LABEL: Record<PackRoundStatus, string> = { not_started: "Not started", in_progress: "In progress", done: "Done" };

// A compact circular readiness meter (0..1 → percentage ring).
function ReadinessRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const r = 26, c = 2 * Math.PI * r;
  return (
    <div className="relative h-[70px] w-[70px] shrink-0">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-line)" strokeWidth="6" />
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--color-accent)" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold">{Math.round(pct * 100)}%</span>
    </div>
  );
}

export default function PacksPage() {
  const t = useT();
  const router = useRouter();
  const { lang } = useLang();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [loading, setLoading] = useState(true);

  // Detail view state (same page, selected pack).
  const [selected, setSelected] = useState<PackDetail | null>(null);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [starting, setStarting] = useState(""); // roundId being started
  const [startErr, setStartErr] = useState("");

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [p, ps] = await Promise.all([api.getProfile(), api.listPacks()]);
      setProfile(p);
      setPacks(ps);
      setLoading(false);
    })();
  }, [router]);

  // Gate packs by the user's professions: show a pack only if its areas
  // intersect the user's professions. If the user hasn't picked any professions
  // yet, show all packs rather than an empty page.
  const visible = useMemo(() => {
    const profs = profile?.professions ?? [];
    if (profs.length === 0) return packs;
    return packs.filter((pk) => pk.areas.some((a) => profs.includes(a)));
  }, [packs, profile]);

  async function openPack(id: string) {
    setDetailLoading(true); setStartErr(""); setSelected(null); setProgress(null);
    try {
      const [d, pr] = await Promise.all([api.getPack(id), api.packProgress(id)]);
      setSelected(d); setProgress(pr);
    } finally { setDetailLoading(false); }
  }

  async function startRound(packId: string, roundId: string, minutes: number) {
    setStarting(roundId); setStartErr("");
    try {
      // Mirror setup's start flow: run this interview in the app language, then
      // create the session (with pack context) and hand off to the live page.
      const cfg = { ...(await api.getConfig()), language: lang };
      const s = await api.startRound(packId, roundId, cfg);
      router.push(`/interview?s=${s.id}&minutes=${minutes}`);
    } catch (e) {
      setStartErr(e instanceof Error ? e.message : "Could not start the round.");
      setStarting("");
    }
  }

  // The next round to run = first not-yet-done round (in a linear loop).
  const nextRoundId = useMemo(() => progress?.rounds.find((r) => r.status !== "done")?.round.id, [progress]);

  return (
    <AppShell active="interview">
      {!selected ? (
        <>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("Practice Packs")}</h1>
          <p className="mt-1 text-[var(--color-muted)]">{t("Company-style interview loops — run them round by round and track your readiness.")}</p>

          {loading ? (
            <p className="mt-8 text-[var(--color-muted)]">{t("Loading…")}</p>
          ) : visible.length === 0 ? (
            <Panel className="mt-8 p-10 text-center text-[var(--color-muted)]">
              {t("No packs for your professions yet.")} <Button href="/settings" variant="ghost" className="ml-2">{t("Edit professions →")}</Button>
            </Panel>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {visible.map((pk) => (
                <Panel key={pk.id} className="flex h-full flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      {/* Pack name/company are our data — kept in English like the catalog. */}
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">{pk.company}</div>
                      <h3 className="text-lg font-semibold leading-snug">{pk.name}</h3>
                    </div>
                    <Badge tone="muted">{pk.rounds.length} {t("rounds")}</Badge>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-[var(--color-muted)]">{pk.blurb}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {pk.rounds.map((r) => (
                      <span key={r.id} className="rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-faint)]">{pretty(r.kind)}</span>
                    ))}
                  </div>
                  <Button onClick={() => openPack(pk.id)} className="mt-4 self-start">{t("Open pack →")}</Button>
                </Panel>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button onClick={() => { setSelected(null); setProgress(null); setStartErr(""); }}
            className="text-sm text-[var(--color-accent)] hover:brightness-125">← {t("All packs")}</button>

          <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">{selected.company}</div>
              <h1 className="text-3xl font-extrabold tracking-tight">{selected.name}</h1>
              <p className="mt-1 max-w-2xl text-[var(--color-muted)]">{selected.blurb}</p>
            </div>
            {progress && (
              <div className="flex items-center gap-3">
                <ReadinessRing value={progress.overall_readiness} />
                <div className="text-sm">
                  <div className="font-semibold">{t("Readiness")}</div>
                  <div className="text-[var(--color-faint)]">{t("across all rounds")}</div>
                </div>
              </div>
            )}
          </div>

          {nextRoundId && (
            <div className="mt-5">
              <Button onClick={() => {
                const r = selected.rounds.find((x) => x.id === nextRoundId);
                if (r) void startRound(selected.id, r.id, r.minutes);
              }} disabled={starting !== ""} className="px-6">
                {starting === nextRoundId ? t("Starting…") : t("Start next round →")}
              </Button>
            </div>
          )}

          {detailLoading || !progress ? (
            <p className="mt-8 text-[var(--color-muted)]">{t("Loading…")}</p>
          ) : (
            <div className="mt-6 space-y-3">
              {selected.rounds.map((r, i) => {
                const pr = progress.rounds.find((x) => x.round.id === r.id);
                const status: PackRoundStatus = pr?.status ?? "not_started";
                const done = status === "done";
                return (
                  <Panel key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-panel-2)] text-xs font-bold text-[var(--color-faint)]">{i + 1}</span>
                        <span className="truncate font-semibold">{r.title}</span>
                        <span className="shrink-0 rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-muted)]">{pretty(r.kind)}</span>
                      </div>
                      <div className="mt-1 pl-8 text-xs text-[var(--color-faint)]">⏱ ~{r.minutes} {t("minutes")} · {pretty(r.difficulty)}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge tone={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Badge>
                      {done && pr?.overall !== undefined && <Badge tone="good">{pr.overall.toFixed(1)} / 4</Badge>}
                      {done && pr?.session_id
                        ? <Button href={`/report?s=${pr.session_id}`} variant="ghost">{t("View report →")}</Button>
                        : <Button onClick={() => void startRound(selected.id, r.id, r.minutes)} disabled={starting !== ""} variant={status === "in_progress" ? "primary" : "ghost"}>
                            {starting === r.id ? t("Starting…") : status === "in_progress" ? t("Resume →") : t("Start →")}
                          </Button>}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
          {startErr && <p className="mt-3 text-sm text-[var(--color-bad)]">{startErr}</p>}
        </>
      )}
    </AppShell>
  );
}

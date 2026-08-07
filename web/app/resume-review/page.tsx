"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Resume, ResumeReview, ResumeMatch, ResumeParsed } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { ResumeDoc, type Mark } from "@/components/resume/ResumeDoc";
import { useT } from "@/lib/i18n";

type Tab = "review" | "match";

const reviewColor = (s: number) => (s >= 4 ? "var(--color-good)" : s >= 3 ? "var(--color-warn)" : "var(--color-bad)");
const matchColor = (s: number) => (s >= 70 ? "var(--color-good)" : s >= 40 ? "var(--color-warn)" : "var(--color-bad)");

// ---- localStorage cache (per resume id) so results survive reloads ----
const REVIEW_KEY = (id: string) => `mi_resume_review_${id}`;
const MATCH_KEY = (id: string) => `mi_resume_match_${id}`;
const APPLIED_KEY = (id: string) => `mi_resume_applied_${id}`;

function isReview(v: unknown): v is ResumeReview {
  return !!v && typeof v === "object" && typeof (v as ResumeReview).overall_score === "number";
}
function isMatch(v: unknown): v is ResumeMatch {
  return !!v && typeof v === "object" && typeof (v as ResumeMatch).match_score === "number";
}
function readCache<T>(key: string, validate: (v: unknown) => v is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const val = JSON.parse(raw) as unknown;
    if (validate(val)) return val;
  } catch { /* fall through to drop */ }
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  return null;
}
function readAppliedCache(key: string): number[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const val = JSON.parse(raw) as unknown;
    if (Array.isArray(val) && val.every((x) => typeof x === "number")) return val as number[];
  } catch { /* fall through to drop */ }
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
  return null;
}
function writeCache(key: string, val: unknown) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota/again ignore */ }
}
function clearCache(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(REVIEW_KEY(id));
    window.localStorage.removeItem(MATCH_KEY(id));
    window.localStorage.removeItem(APPLIED_KEY(id));
  } catch { /* ignore */ }
}

export default function ResumePage() {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("review");
  const [resume, setResume] = useState<Resume | null>(null);
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [match, setMatch] = useState<ResumeMatch | null>(null);
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [jd, setJd] = useState("");            // kept in state only; never rendered on the page
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const r = await api.getResume();
      setResume(r);
      if (!r) return;
      // Hydrate previously-cached analysis so the page shows prior results
      // immediately without re-calling the LLM. Bad/partial cache is dropped.
      const cachedReview = readCache(REVIEW_KEY(r.id), isReview);
      if (cachedReview) {
        setReview(cachedReview);
        const savedApplied = readAppliedCache(APPLIED_KEY(r.id));
        if (savedApplied) {
          const n = cachedReview.line_edits?.length ?? 0;
          setApplied(new Set(savedApplied.filter((i) => i >= 0 && i < n)));
        }
      }
      const cachedMatch = readCache(MATCH_KEY(r.id), isMatch);
      if (cachedMatch) setMatch(cachedMatch);
    })();
  }, [router]);

  // Persist the applied-edit set whenever it changes (only once a review exists).
  useEffect(() => {
    if (!resume || !review) return;
    writeCache(APPLIED_KEY(resume.id), Array.from(applied));
  }, [applied, resume, review]);

  async function ingest(file: File) {
    setUploading(true); setErr(""); setReview(null); setMatch(null); setApplied(new Set());
    try {
      const r = await api.uploadResume(file);
      setResume(r);
      clearCache(r.id); // fresh upload — start clean even if the id is reused
    } catch (e) { setErr(e instanceof Error ? e.message : t("Upload failed")); }
    finally { setUploading(false); }
  }
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void ingest(file);
    e.target.value = "";
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingest(file);
  }

  async function runReview() {
    setBusy(true); setErr("");
    try {
      const rv = await api.reviewResume();
      setReview(rv); setApplied(new Set());
      if (resume) { writeCache(REVIEW_KEY(resume.id), rv); writeCache(APPLIED_KEY(resume.id), []); }
    }
    catch (e) { setErr(e instanceof Error ? e.message : t("Review failed")); }
    finally { setBusy(false); }
  }
  async function runMatch(text: string) {
    setBusy(true); setErr("");
    try {
      const m = await api.matchResume(text);
      setMatch(m); setJd(text); setModalOpen(false);
      if (resume) writeCache(MATCH_KEY(resume.id), m);
    } catch (e) { setErr(e instanceof Error ? e.message : t("Match failed")); }
    finally { setBusy(false); }
  }

  // ---- apply/undo of suggested line edits (reflected in the rendered doc) ----
  function toggleEdit(i: number, on: boolean) {
    setApplied((prev) => { const next = new Set(prev); if (on) next.add(i); else next.delete(i); return next; });
  }
  function applyAll() {
    if (!review) return;
    setApplied(new Set((review.line_edits ?? []).map((_, i) => i)));
  }

  // Working (edited) copies derived from applied edits.
  const workingParsed = useMemo(
    () => (review ? transformParsed(resume?.parsed, review.line_edits ?? [], applied) : resume?.parsed),
    [resume, review, applied],
  );
  const workingText = useMemo(
    () => (review ? subAll(resume?.text ?? "", review.line_edits ?? [], applied) : resume?.text ?? ""),
    [resume, review, applied],
  );

  // Highlight marks for the rendered resume, per tab.
  const marks: Mark[] = useMemo(() => {
    if (tab === "review" && review) {
      const m: Mark[] = [];
      (review.line_edits ?? []).forEach((e, i) => {
        if (applied.has(i)) m.push({ str: e?.improved, cls: "mi-hl-good" });
        else m.push({ str: e?.original, cls: "mi-hl-warn" });
      });
      (review.quantifiable_impacts ?? []).forEach((q) => m.push({ str: q?.text, cls: "mi-hl-good" }));
      return m.filter((x) => x.str);
    }
    if (tab === "match" && match) {
      const m: Mark[] = [];
      (match.matched_keywords ?? []).forEach((k) => m.push({ str: k, cls: "mi-hl-accent" }));
      (match.missing_keywords ?? []).forEach((k) => m.push({ str: k, cls: "mi-hl-bad" }));
      return m.filter((x) => x.str);
    }
    return [];
  }, [tab, review, match, applied]);

  function download() {
    const blob = new Blob([workingText || resumeToText(workingParsed)], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (resume?.filename?.replace(/\.[^.]+$/, "") ?? "resume") + ".revised.md";
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <AppShell active="resume">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">{t("Resume")}</h1>
          <p className="mt-1 text-[var(--color-muted)]">{t("Get a scored critique with inline fixes, or match your resume against a specific job.")}</p>
        </div>
        {resume && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? t("Uploading…") : t("Replace")}</Button>
            {tab === "review" ? (
              <>
                {review && <Button variant="ghost" onClick={applyAll} title={t("Apply every suggested edit")}>{t("Apply all")}</Button>}
                {review && <Button variant="ghost" onClick={download} title={t("Download the revised resume")}>{t("⬇ Download")}</Button>}
                <Button onClick={runReview} disabled={busy}>{busy ? t("Reviewing…") : review ? t("Re-review") : t("Review")}</Button>
              </>
            ) : (
              <Button onClick={() => setModalOpen(true)} disabled={busy}>{match ? t("Re-match / new job") : t("Match to a job")}</Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label={t("Resume tools")} className="mt-5 inline-flex rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-1">
        {(["review", "match"] as Tab[]).map((tabId) => (
          <button
            key={tabId}
            role="tab"
            aria-selected={tab === tabId}
            onClick={() => setTab(tabId)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === tabId ? "bg-[var(--color-accent)] text-[#0b0d12]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}
          >
            {tabId === "review" ? t("General Review") : t("Job Match")}
          </button>
        ))}
      </div>

      {err && <p className="mt-3 text-sm text-[var(--color-bad)]">{err}</p>}

      {/* Empty state — drag & drop upload zone */}
      {!resume && (
        <div className="mt-6">
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            aria-label={t("Upload resume: drag and drop or click to browse")}
            className={`mi-panel flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-20 text-center transition ${dragOver ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : "border-[var(--color-line)] hover:border-[var(--color-accent)]"}`}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="mt-4 text-lg font-semibold">{uploading ? t("Uploading…") : t("Drag & Drop Resume")}</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{t("or click to browse (PDF, DOCX, TXT, MD)")}</p>
          </button>
        </div>
      )}

      {/* Split pane */}
      {resume && (
        <div className="mt-6 flex flex-col gap-4 lg:flex-row">
          {/* LEFT — rendered resume */}
          <Panel className="overflow-hidden lg:flex-[1.35]">
            <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
              <span className="truncate">{resume.filename}</span>
              {tab === "review" && review ? (
                <span className="flex flex-none items-center gap-3" title={t("Colored highlights in the resume below mark what to change and what's already strong.")}>
                  <Swatch color="var(--color-warn)" label={t("Suggested fix")} />
                  <Swatch color="var(--color-good)" label={t("Applied / strong")} />
                </span>
              ) : tab === "match" && match ? (
                <span className="flex flex-none items-center gap-3" title={t("Highlights show how your resume overlaps the job description.")}>
                  <Swatch color="var(--color-accent)" label={t("Matched")} />
                  <Swatch color="var(--color-bad)" label={t("Missing")} />
                </span>
              ) : <span />}
            </div>
            <ResumeDoc parsed={workingParsed} text={workingText} marks={marks} expand={tab === "review" ? !!review : !!match} />
          </Panel>

          {/* RIGHT — analysis panel */}
          <div className="space-y-4 lg:flex-1 lg:min-w-[320px]">
            {tab === "review" ? (
              <ReviewPanel review={review} busy={busy} applied={applied} workingText={workingText} onToggle={toggleEdit} onRun={runReview} />
            ) : (
              <MatchPanel match={match} busy={busy} onOpen={() => setModalOpen(true)} />
            )}
          </div>
        </div>
      )}

      {modalOpen && <JdModal busy={busy} onClose={() => setModalOpen(false)} onSubmit={runMatch} initial={jd} />}
    </AppShell>
  );
}

// ---------------- Review panel ----------------
function ReviewPanel({
  review, busy, applied, workingText, onToggle, onRun,
}: {
  review: ResumeReview | null; busy: boolean; applied: Set<number>; workingText: string;
  onToggle: (i: number, on: boolean) => void; onRun: () => void;
}) {
  const t = useT();
  if (!review) {
    return (
      <Panel className="p-6 text-sm text-[var(--color-muted)]">
        {t("Click")} <b className="text-[var(--color-ink)]">{t("Review")}</b> {t("for a scored critique with inline, line-by-line fixes you can apply and undo.")}
        <div className="mt-4"><Button onClick={onRun} disabled={busy}>{busy ? t("Reviewing…") : t("Review my resume")}</Button></div>
      </Panel>
    );
  }
  const edits = review.line_edits ?? [];
  const fixes = review.critical_fixes ?? [];
  const impacts = review.quantifiable_impacts ?? [];
  const strengths = review.strengths ?? [];
  const gaps = review.gaps ?? [];
  const impactSuggestions = review.impact_suggestions ?? [];
  const ats = review.ats_breakdown;
  const score = Number(review.overall_score) || 0;
  return (
    <>
      {/* Score card */}
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing pct={Math.max(0, Math.min(1, score / 5))} color={reviewColor(score)} big={score.toFixed(1)} small="/ 5" />
          <div className="flex-1">
            <div className="text-sm font-semibold">{t("Overall score")}</div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{review.summary ?? ""}</p>
          </div>
        </div>
      </Panel>

      {/* Critical fixes — with inline apply/undo where an original phrase exists */}
      <Panel className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          {t("Critical fixes")}
          <span className="rounded-full bg-[color-mix(in_srgb,var(--color-bad)_22%,transparent)] px-2 py-0.5 text-xs text-[var(--color-bad)]">{fixes.length || edits.length}</span>
          <span className="ml-auto text-xs font-normal text-[var(--color-faint)]">{applied.size}/{edits.length} {t("applied")}</span>
        </h3>
        <div className="space-y-3">
          {fixes.map((f, i) => {
            const edit = edits.find((e) => (e?.original ? (f?.detail?.includes(e.original) || f?.title?.includes(e.original)) : false));
            return (
              <div key={`f${i}`} className="rounded-xl border border-[var(--color-line)] p-3 text-sm [overflow-wrap:anywhere]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{f?.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{f?.location}</span>
                </div>
                <p className="mt-1 text-[var(--color-muted)]">{f?.detail}</p>
                {edit && <EditRow edit={edit} idx={edits.indexOf(edit)} applied={applied} workingText={workingText} onToggle={onToggle} />}
              </div>
            );
          })}
          {/* Any line edits not surfaced by a critical fix still get an apply row. */}
          {edits.map((e, i) => {
            const shownByFix = fixes.some((f) => (e?.original ? (f?.detail?.includes(e.original) || f?.title?.includes(e.original)) : false));
            if (shownByFix) return null;
            return (
              <div key={`e${i}`} className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <EditRow edit={e} idx={i} applied={applied} workingText={workingText} onToggle={onToggle} />
              </div>
            );
          })}
        </div>
      </Panel>

      {/* Quantifiable impacts (green) */}
      {impacts.length > 0 && (
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold">{t("Quantifiable impact")}</h3>
          <ul className="space-y-2">
            {impacts.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 text-[var(--color-good)]" aria-hidden="true">✓</span>
                <span><span className="font-medium text-[var(--color-good)]">{q?.text}</span><span className="text-[var(--color-muted)]"> — {q?.note}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Strengths / gaps */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="good">{t("Strengths")}</Badge></h3>{strengths.length > 0 ? <ul className="space-y-1 text-xs text-[var(--color-muted)]">{strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul> : <p className="text-xs italic text-[var(--color-faint)]">{t("None noted")}</p>}</Panel>
        <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="warn">{t("Gaps")}</Badge></h3>{gaps.length > 0 ? <ul className="space-y-1 text-xs text-[var(--color-muted)]">{gaps.map((s, i) => <li key={i}>• {s}</li>)}</ul> : <p className="text-xs italic text-[var(--color-faint)]">{t("None noted — solid across the board")}</p>}</Panel>
      </div>

      {/* ATS compatibility */}
      <Panel className="p-5">
        <h3 className="mb-3 text-sm font-semibold">{t("ATS compatibility")}</h3>
        {ats && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-muted)]">{t("Formatting")}</span>
              <AtsBadge status={ats.formatting} />
              <span className="ml-auto text-[var(--color-muted)]">{t("Keyword match")}</span>
              <span className="font-semibold">{Math.round(Number(ats.keyword_match) || 0)}%</span>
            </div>
            <div className="mt-2.5"><Bar pct={(Number(ats.keyword_match) || 0) / 100} color={matchColor(Number(ats.keyword_match) || 0)} /></div>
            <p className="mt-2 text-xs text-[var(--color-muted)]">{ats.notes}</p>
          </>
        )}
        <h4 className="mb-1 mt-3 text-xs font-semibold text-[var(--color-faint)]">{t("Notes")}</h4>
        <p className="text-xs text-[var(--color-muted)]">{review.ats_notes ?? ""}</p>
        {impactSuggestions.length > 0 && (
          <>
            <h4 className="mb-1 mt-3 text-xs font-semibold text-[var(--color-faint)]">{t("Impact suggestions")}</h4>
            <ul className="space-y-1 text-xs text-[var(--color-muted)]">{impactSuggestions.map((s, i) => <li key={i}>• {s}</li>)}</ul>
          </>
        )}
      </Panel>
    </>
  );
}

function EditRow({
  edit, idx, applied, workingText, onToggle,
}: {
  edit: { original: string; improved: string }; idx: number; applied: Set<number>; workingText: string; onToggle: (i: number, on: boolean) => void;
}) {
  const t = useT();
  const isApplied = applied.has(idx);
  const canApply = workingText.includes(edit.original) || isApplied;
  return (
    <div className="mt-2 rounded-lg bg-[var(--color-panel-2)] p-2.5 text-sm [overflow-wrap:anywhere]">
      <div className={`text-[var(--color-faint)] ${isApplied ? "line-through" : ""}`}>{edit.original}</div>
      <div className="mt-1 text-[var(--color-good)]">{edit.improved}</div>
      <div className="mt-2">
        {isApplied
          ? <button onClick={() => onToggle(idx, false)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">{t("↩ undo")}</button>
          : <button onClick={() => onToggle(idx, true)} disabled={!canApply} className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[#0b0d12] disabled:opacity-40">{t("Apply")}</button>}
      </div>
    </div>
  );
}

// Swatch is the little colored-dot + label used in the resume highlight legend,
// so the meaning of the in-document highlights is self-explanatory.
function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: `color-mix(in srgb, ${color} 55%, transparent)`, boxShadow: `inset 0 0 0 1px ${color}` }} />
      <span className="text-[var(--color-muted)]">{label}</span>
    </span>
  );
}

function AtsBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const tone = s === "pass" ? "good" : s === "fail" ? "bad" : "warn";
  return <Badge tone={tone as "good" | "warn" | "bad"}>{status || "—"}</Badge>;
}

// ---------------- Match panel ----------------
function MatchPanel({ match, busy, onOpen }: { match: ResumeMatch | null; busy: boolean; onOpen: () => void }) {
  const t = useT();
  if (!match) {
    return (
      <Panel className="p-6 text-sm text-[var(--color-muted)]">
        {t("Paste a job description and we'll score how well your resume fits — matched vs. missing keywords and specific tailoring suggestions. The job description stays private and is never shown on the page.")}
        <div className="mt-4"><Button onClick={onOpen} disabled={busy}>{t("Paste job description")}</Button></div>
      </Panel>
    );
  }
  const matched = match.matched_keywords ?? [];
  const missing = match.missing_keywords ?? [];
  const suggestions = match.tailoring_suggestions ?? [];
  const matchScore = Number(match.match_score) || 0;
  const atsKeyword = Number(match.ats_keyword_match) || 0;
  return (
    <>
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing pct={Math.max(0, Math.min(1, matchScore / 100))} color={matchColor(matchScore)} big={`${Math.round(matchScore)}`} small="%" />
          <div className="flex-1">
            <div className="text-sm font-semibold">{t("Match score")}</div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{match.verdict ?? ""}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-[var(--color-faint)]"><span>{t("ATS keyword coverage")}</span><span>{Math.round(atsKeyword)}%</span></div>
          <Bar pct={atsKeyword / 100} color={matchColor(atsKeyword)} />
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold">{t("Matched")} <span className="text-xs font-normal text-[var(--color-faint)]">({matched.length})</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {matched.map((k, i) => <Chip key={i} tone="good">{k}</Chip>)}
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">{t("Missing / gaps")} <span className="text-xs font-normal text-[var(--color-faint)]">({missing.length})</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {missing.map((k, i) => <Chip key={i} tone="bad">{k}</Chip>)}
        </div>
      </Panel>

      {suggestions.length > 0 && (
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold">{t("AI tailoring suggestions")}</h3>
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <div key={i} className="rounded-xl border border-[var(--color-line)] p-3 text-sm [overflow-wrap:anywhere]">
                <div className="font-semibold">{s?.issue}</div>
                <p className="mt-1 text-[var(--color-muted)]">{s?.detail}</p>
                <p className="mt-1.5 text-[var(--color-accent)]">→ {s?.suggestion}</p>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone: "good" | "bad" }) {
  const cls = tone === "good"
    ? "border-[color-mix(in_srgb,var(--color-good)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-good)_14%,transparent)] text-[var(--color-good)]"
    : "border-[color-mix(in_srgb,var(--color-bad)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-bad)_14%,transparent)] text-[var(--color-bad)]";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

// ---------------- JD modal ----------------
function JdModal({ busy, onClose, onSubmit, initial }: { busy: boolean; onClose: () => void; onSubmit: (jd: string) => void; initial: string }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="jd-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="mi-panel relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6"
      >
        <h2 id="jd-title" className="text-lg font-bold">{t("Paste the job description")}</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">{t("We analyze it against your resume and show only the results — the description is not displayed on the page.")}</p>
        <label htmlFor="jd-text" className="sr-only">{t("Job description")}</label>
        <textarea
          id="jd-text"
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Paste the full job description here…")}
          className="mt-4 h-64 w-full flex-1 resize-none overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] p-3.5 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
          <Button onClick={() => onSubmit(text.trim())} disabled={busy || text.trim().length === 0}>{busy ? t("Analyzing…") : t("Analyze match")}</Button>
        </div>
      </div>
    </div>
  );
}

// ---------------- shared bits ----------------
function ScoreRing({ pct, color, big, small }: { pct: number; color: string; big: string; small: string }) {
  const deg = Math.round(pct * 360);
  return (
    <div
      className="relative flex h-20 w-20 flex-none items-center justify-center rounded-full"
      style={{ background: `conic-gradient(${color} ${deg}deg, var(--color-line) ${deg}deg)` }}
    >
      <div className="flex h-[62px] w-[62px] flex-col items-center justify-center rounded-full bg-[var(--color-panel)]">
        <span className="text-lg font-extrabold leading-none">{big}</span>
        <span className="text-[9px] text-[var(--color-faint)]">{small}</span>
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, background: color }} />
    </div>
  );
}

// ---------------- edit application helpers ----------------
function subAll(s: string, edits: { original: string; improved: string }[], applied: Set<number>): string {
  let t = s;
  applied.forEach((i) => { const e = edits[i]; if (e && e.original) t = t.split(e.original).join(e.improved); });
  return t;
}

function transformParsed(parsed: ResumeParsed | undefined, edits: { original: string; improved: string }[], applied: Set<number>): ResumeParsed | undefined {
  if (!parsed) return parsed;
  const clone: ResumeParsed = JSON.parse(JSON.stringify(parsed));
  const sub = (s: string) => subAll(s, edits, applied);
  if (clone.summary) clone.summary = sub(clone.summary);
  clone.experience?.forEach((x) => { if (x.bullets) x.bullets = x.bullets.map(sub); });
  clone.projects?.forEach((x) => { if (x.summary) x.summary = sub(x.summary); });
  return clone;
}

// resumeToText is a last-resort download body when we have no raw text.
function resumeToText(p?: ResumeParsed): string {
  if (!p) return "";
  const lines: string[] = [];
  if (p.name) lines.push(p.name);
  if (p.headline) lines.push(p.headline);
  if (p.summary) lines.push("", "SUMMARY", p.summary);
  if (p.experience?.length) {
    lines.push("", "EXPERIENCE");
    p.experience.forEach((e) => {
      lines.push(`${[e.role, e.company].filter(Boolean).join(" — ")} ${[e.start, e.end].filter(Boolean).join(" – ")}`.trim());
      (e.bullets ?? []).forEach((b) => lines.push(`- ${b}`));
    });
  }
  return lines.join("\n");
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Resume, ResumeReview, ResumeMatch, ResumeParsed } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { ResumeDoc, type Mark } from "@/components/resume/ResumeDoc";

type Tab = "review" | "match";

const reviewColor = (s: number) => (s >= 4 ? "var(--color-good)" : s >= 3 ? "var(--color-warn)" : "var(--color-bad)");
const matchColor = (s: number) => (s >= 70 ? "var(--color-good)" : s >= 40 ? "var(--color-warn)" : "var(--color-bad)");

export default function ResumePage() {
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
    })();
  }, [router]);

  async function ingest(file: File) {
    setUploading(true); setErr(""); setReview(null); setMatch(null); setApplied(new Set());
    try {
      const r = await api.uploadResume(file);
      setResume(r);
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
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
    try { const rv = await api.reviewResume(); setReview(rv); setApplied(new Set()); }
    catch (e) { setErr(e instanceof Error ? e.message : "Review failed"); }
    finally { setBusy(false); }
  }
  async function runMatch(text: string) {
    setBusy(true); setErr("");
    try {
      const m = await api.matchResume(text);
      setMatch(m); setJd(text); setModalOpen(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Match failed"); }
    finally { setBusy(false); }
  }

  // ---- apply/undo of suggested line edits (reflected in the rendered doc) ----
  function toggleEdit(i: number, on: boolean) {
    setApplied((prev) => { const next = new Set(prev); if (on) next.add(i); else next.delete(i); return next; });
  }
  function applyAll() {
    if (!review) return;
    setApplied(new Set(review.line_edits.map((_, i) => i)));
  }

  // Working (edited) copies derived from applied edits.
  const workingParsed = useMemo(
    () => (review ? transformParsed(resume?.parsed, review.line_edits, applied) : resume?.parsed),
    [resume, review, applied],
  );
  const workingText = useMemo(
    () => (review ? subAll(resume?.text ?? "", review.line_edits, applied) : resume?.text ?? ""),
    [resume, review, applied],
  );

  // Highlight marks for the rendered resume, per tab.
  const marks: Mark[] = useMemo(() => {
    if (tab === "review" && review) {
      const m: Mark[] = [];
      review.line_edits.forEach((e, i) => {
        if (applied.has(i)) m.push({ str: e.improved, cls: "mi-hl-good" });
        else m.push({ str: e.original, cls: "mi-hl-warn" });
      });
      (review.quantifiable_impacts ?? []).forEach((q) => m.push({ str: q.text, cls: "mi-hl-good" }));
      return m;
    }
    if (tab === "match" && match) {
      const m: Mark[] = [];
      match.matched_keywords.forEach((k) => m.push({ str: k, cls: "mi-hl-accent" }));
      match.missing_keywords.forEach((k) => m.push({ str: k, cls: "mi-hl-bad" }));
      return m;
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
          <h1 className="text-3xl font-extrabold tracking-tight">Resume</h1>
          <p className="mt-1 text-[var(--color-muted)]">Get a scored critique with inline fixes, or match your resume against a specific job.</p>
        </div>
        {resume && (
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Replace"}</Button>
            {tab === "review" ? (
              <>
                {review && <Button variant="ghost" onClick={applyAll} title="Apply every suggested edit">Apply all</Button>}
                {review && <Button variant="ghost" onClick={download} title="Download the revised resume">⬇ Download</Button>}
                <Button onClick={runReview} disabled={busy}>{busy ? "Reviewing…" : review ? "Re-review" : "Review"}</Button>
              </>
            ) : (
              <Button onClick={() => setModalOpen(true)} disabled={busy}>{match ? "Re-match / new job" : "Match to a job"}</Button>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div role="tablist" aria-label="Resume tools" className="mt-5 inline-flex rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-1">
        {(["review", "match"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${tab === t ? "bg-[var(--color-accent)] text-[#0b0d12]" : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"}`}
          >
            {t === "review" ? "General Review" : "Job Match"}
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
            aria-label="Upload resume: drag and drop or click to browse"
            className={`mi-panel flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-20 text-center transition ${dragOver ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]" : "border-[var(--color-line)] hover:border-[var(--color-accent)]"}`}
          >
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="mt-4 text-lg font-semibold">{uploading ? "Uploading…" : "Drag & Drop Resume"}</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">or click to browse (PDF, DOCX, TXT, MD)</p>
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
              <span>{tab === "review" && review ? "amber = fix · green = applied/strong" : tab === "match" && match ? "cyan = matched keyword" : " "}</span>
            </div>
            <ResumeDoc parsed={workingParsed} text={workingText} marks={marks} />
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
  if (!review) {
    return (
      <Panel className="p-6 text-sm text-[var(--color-muted)]">
        Click <b className="text-[var(--color-ink)]">Review</b> for a scored critique with inline, line-by-line fixes you can apply and undo.
        <div className="mt-4"><Button onClick={onRun} disabled={busy}>{busy ? "Reviewing…" : "Review my resume"}</Button></div>
      </Panel>
    );
  }
  const fixes = review.critical_fixes ?? [];
  const impacts = review.quantifiable_impacts ?? [];
  const ats = review.ats_breakdown;
  return (
    <>
      {/* Score card */}
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing pct={Math.max(0, Math.min(1, review.overall_score / 5))} color={reviewColor(review.overall_score)} big={review.overall_score.toFixed(1)} small="/ 5" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Overall score</div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{review.summary}</p>
          </div>
        </div>
      </Panel>

      {/* Critical fixes — with inline apply/undo where an original phrase exists */}
      <Panel className="p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          Critical fixes
          <span className="rounded-full bg-[color-mix(in_srgb,var(--color-bad)_22%,transparent)] px-2 py-0.5 text-xs text-[var(--color-bad)]">{fixes.length || review.line_edits.length}</span>
          <span className="ml-auto text-xs font-normal text-[var(--color-faint)]">{applied.size}/{review.line_edits.length} applied</span>
        </h3>
        <div className="space-y-3">
          {fixes.map((f, i) => {
            const edit = review.line_edits.find((e) => f.detail.includes(e.original) || f.title.includes(e.original));
            return (
              <div key={`f${i}`} className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{f.title}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--color-faint)]">{f.location}</span>
                </div>
                <p className="mt-1 text-[var(--color-muted)]">{f.detail}</p>
                {edit && <EditRow edit={edit} idx={review.line_edits.indexOf(edit)} applied={applied} workingText={workingText} onToggle={onToggle} />}
              </div>
            );
          })}
          {/* Any line edits not surfaced by a critical fix still get an apply row. */}
          {review.line_edits.map((e, i) => {
            const shownByFix = fixes.some((f) => f.detail.includes(e.original) || f.title.includes(e.original));
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
          <h3 className="mb-3 text-sm font-semibold">Quantifiable impact</h3>
          <ul className="space-y-2">
            {impacts.map((q, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-0.5 text-[var(--color-good)]" aria-hidden="true">✓</span>
                <span><span className="font-medium text-[var(--color-good)]">{q.text}</span><span className="text-[var(--color-muted)]"> — {q.note}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Strengths / gaps */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="good">Strengths</Badge></h3><ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul></Panel>
        <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="warn">Gaps</Badge></h3><ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.gaps.map((s, i) => <li key={i}>• {s}</li>)}</ul></Panel>
      </div>

      {/* ATS compatibility */}
      <Panel className="p-5">
        <h3 className="mb-3 text-sm font-semibold">ATS compatibility</h3>
        {ats && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--color-muted)]">Formatting</span>
              <AtsBadge status={ats.formatting} />
              <span className="ml-auto text-[var(--color-muted)]">Keyword match</span>
              <span className="font-semibold">{Math.round(ats.keyword_match)}%</span>
            </div>
            <Bar pct={ats.keyword_match / 100} color={matchColor(ats.keyword_match)} />
            <p className="mt-2 text-xs text-[var(--color-muted)]">{ats.notes}</p>
          </>
        )}
        <h4 className="mb-1 mt-3 text-xs font-semibold text-[var(--color-faint)]">Notes</h4>
        <p className="text-xs text-[var(--color-muted)]">{review.ats_notes}</p>
        {review.impact_suggestions.length > 0 && (
          <>
            <h4 className="mb-1 mt-3 text-xs font-semibold text-[var(--color-faint)]">Impact suggestions</h4>
            <ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.impact_suggestions.map((s, i) => <li key={i}>• {s}</li>)}</ul>
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
  const isApplied = applied.has(idx);
  const canApply = workingText.includes(edit.original) || isApplied;
  return (
    <div className="mt-2 rounded-lg bg-[var(--color-panel-2)] p-2.5 text-sm">
      <div className={`text-[var(--color-faint)] ${isApplied ? "line-through" : ""}`}>{edit.original}</div>
      <div className="mt-1 text-[var(--color-good)]">{edit.improved}</div>
      <div className="mt-2">
        {isApplied
          ? <button onClick={() => onToggle(idx, false)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">↩ undo</button>
          : <button onClick={() => onToggle(idx, true)} disabled={!canApply} className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[#0b0d12] disabled:opacity-40">Apply</button>}
      </div>
    </div>
  );
}

function AtsBadge({ status }: { status: string }) {
  const s = (status || "").toLowerCase();
  const tone = s === "pass" ? "good" : s === "fail" ? "bad" : "warn";
  return <Badge tone={tone as "good" | "warn" | "bad"}>{status || "—"}</Badge>;
}

// ---------------- Match panel ----------------
function MatchPanel({ match, busy, onOpen }: { match: ResumeMatch | null; busy: boolean; onOpen: () => void }) {
  if (!match) {
    return (
      <Panel className="p-6 text-sm text-[var(--color-muted)]">
        Paste a job description and we&apos;ll score how well your resume fits — matched vs. missing keywords and specific tailoring suggestions. The job description stays private and is never shown on the page.
        <div className="mt-4"><Button onClick={onOpen} disabled={busy}>Paste job description</Button></div>
      </Panel>
    );
  }
  return (
    <>
      <Panel className="p-5">
        <div className="flex items-center gap-4">
          <ScoreRing pct={Math.max(0, Math.min(1, match.match_score / 100))} color={matchColor(match.match_score)} big={`${Math.round(match.match_score)}`} small="%" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Match score</div>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{match.verdict}</p>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-[var(--color-faint)]"><span>ATS keyword coverage</span><span>{Math.round(match.ats_keyword_match)}%</span></div>
          <Bar pct={match.ats_keyword_match / 100} color={matchColor(match.ats_keyword_match)} />
        </div>
      </Panel>

      <Panel className="p-5">
        <h3 className="mb-2 text-sm font-semibold">Matched <span className="text-xs font-normal text-[var(--color-faint)]">({match.matched_keywords.length})</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {match.matched_keywords.map((k, i) => <Chip key={i} tone="good">{k}</Chip>)}
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Missing / gaps <span className="text-xs font-normal text-[var(--color-faint)]">({match.missing_keywords.length})</span></h3>
        <div className="flex flex-wrap gap-1.5">
          {match.missing_keywords.map((k, i) => <Chip key={i} tone="bad">{k}</Chip>)}
        </div>
      </Panel>

      {match.tailoring_suggestions.length > 0 && (
        <Panel className="p-5">
          <h3 className="mb-3 text-sm font-semibold">AI tailoring suggestions</h3>
          <div className="space-y-3">
            {match.tailoring_suggestions.map((s, i) => (
              <div key={i} className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <div className="font-semibold">{s.issue}</div>
                <p className="mt-1 text-[var(--color-muted)]">{s.detail}</p>
                <p className="mt-1.5 text-[var(--color-accent)]">→ {s.suggestion}</p>
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
        <h2 id="jd-title" className="text-lg font-bold">Paste the job description</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">We analyze it against your resume and show only the results — the description is not displayed on the page.</p>
        <label htmlFor="jd-text" className="sr-only">Job description</label>
        <textarea
          id="jd-text"
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the full job description here…"
          className="mt-4 h-64 w-full flex-1 resize-none overflow-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-studio)] p-3.5 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
        />
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(text.trim())} disabled={busy || text.trim().length === 0}>{busy ? "Analyzing…" : "Analyze match"}</Button>
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

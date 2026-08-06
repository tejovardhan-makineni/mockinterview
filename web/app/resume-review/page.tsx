"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Resume, ResumeReview } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { AppShell } from "@/components/AppShell";

const scoreColor = (s: number) => (s >= 4 ? "var(--color-good)" : s >= 3 ? "var(--color-warn)" : "var(--color-bad)");

export default function ResumeReviewPage() {
  const router = useRouter();
  const [resume, setResume] = useState<Resume | null>(null);
  const [review, setReview] = useState<ResumeReview | null>(null);
  const [working, setWorking] = useState("");           // current (editable) resume text
  const [applied, setApplied] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const r = await api.getResume();
      setResume(r);
      if (r?.text) setWorking(r.text);
    })();
  }, [router]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setErr(""); setReview(null); setApplied(new Set());
    try {
      const r = await api.uploadResume(file);
      setResume(r);
      setWorking(r.text ?? "");
    } catch (e) { setErr(e instanceof Error ? e.message : "Upload failed"); }
    finally { setUploading(false); }
  }

  async function runReview() {
    setBusy(true); setErr("");
    try {
      const rv = await api.reviewResume();
      setReview(rv);
      setApplied(new Set());
      if (resume?.text) setWorking(resume.text);
    } catch (e) { setErr(e instanceof Error ? e.message : "Review failed"); }
    finally { setBusy(false); }
  }

  function apply(i: number) {
    if (!review) return;
    const { original, improved } = review.line_edits[i];
    if (!working.includes(original)) return;
    setWorking(working.replace(original, improved));
    setApplied(new Set(applied).add(i));
  }
  function undo(i: number) {
    if (!review) return;
    const { original, improved } = review.line_edits[i];
    if (!working.includes(improved)) return;
    setWorking(working.replace(improved, original));
    const next = new Set(applied); next.delete(i); setApplied(next);
  }
  function applyAll() {
    if (!review) return;
    let t = working; const next = new Set(applied);
    review.line_edits.forEach((e, i) => { if (!next.has(i) && t.includes(e.original)) { t = t.replace(e.original, e.improved); next.add(i); } });
    setWorking(t); setApplied(next);
  }
  function download() {
    const blob = new Blob([working], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = (resume?.filename?.replace(/\.[^.]+$/, "") ?? "resume") + ".revised.md";
    a.click(); URL.revokeObjectURL(a.href);
  }

  // Build highlighted document nodes: pending edits' originals in amber, applied
  // edits' improved text in green.
  const nodes = useMemo(() => {
    if (!review) return [<span key="0">{working}</span>];
    const marks: { str: string; cls: string }[] = [];
    review.line_edits.forEach((e, i) => {
      if (applied.has(i)) marks.push({ str: e.improved, cls: "bg-[color-mix(in_srgb,var(--color-good)_28%,transparent)] rounded px-0.5" });
      else marks.push({ str: e.original, cls: "bg-[color-mix(in_srgb,var(--color-warn)_30%,transparent)] rounded px-0.5" });
    });
    return highlight(working, marks);
  }, [working, review, applied]);

  return (
    <AppShell active="resume">

      <h1 className="mt-6 text-3xl font-bold">Resume review</h1>
      <p className="mt-1 text-[var(--color-muted)]">Upload a resume (PDF, DOCX, TXT, or MD). Get a score, see exactly what to change highlighted in your document, apply fixes, and download the revised version.</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : resume ? "Replace file" : "Upload resume"}</Button>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" hidden onChange={onFile} />
        <span className="text-sm text-[var(--color-muted)]">{resume ? resume.filename : "No resume yet"}</span>
        {resume && <Button onClick={runReview} disabled={busy}>{busy ? "Reviewing…" : review ? "Re-review" : "Review my resume"}</Button>}
        {review && <Button variant="ghost" onClick={applyAll}>Apply all</Button>}
        {review && <Button variant="ghost" onClick={download}>⬇ Download revised</Button>}
      </div>
      {err && <p className="mt-3 text-sm text-[var(--color-bad)]">{err}</p>}

      {!resume && (
        <Panel className="mt-8 p-10 text-center text-[var(--color-muted)]">Upload a resume to begin.</Panel>
      )}

      {resume && (
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          {/* Document with highlights */}
          <Panel className="overflow-hidden">
            <div className="border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
              {review ? "Your resume — highlighted where it needs work (amber), applied fixes (green)" : "Your resume"}
            </div>
            <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap p-5 font-sans text-[13.5px] leading-relaxed text-[var(--color-ink)]">{nodes}</pre>
          </Panel>

          {/* Review panel */}
          <div className="space-y-4">
            {!review && <Panel className="p-6 text-sm text-[var(--color-muted)]">Click <b>Review my resume</b> for a scored critique with line-by-line fixes.</Panel>}
            {review && (
              <>
                <Panel className="flex items-center gap-4 p-5">
                  <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full border-4" style={{ borderColor: scoreColor(review.overall_score) }}>
                    <span className="text-lg font-extrabold">{review.overall_score.toFixed(1)}</span>
                    <span className="text-[9px] text-[var(--color-faint)]">/ 5</span>
                  </div>
                  <p className="flex-1 text-sm text-[var(--color-muted)]">{review.summary}</p>
                </Panel>

                <Panel className="p-5">
                  <h3 className="mb-3 font-semibold">Suggested edits <span className="text-xs font-normal text-[var(--color-faint)]">({applied.size}/{review.line_edits.length} applied)</span></h3>
                  <div className="space-y-3">
                    {review.line_edits.map((e, i) => {
                      const isApplied = applied.has(i);
                      const canApply = working.includes(e.original);
                      return (
                        <div key={i} className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                          <div className={`text-[var(--color-faint)] ${isApplied ? "line-through" : ""}`}>{e.original}</div>
                          <div className="mt-1.5 text-[var(--color-good)]">{e.improved}</div>
                          <div className="mt-2">
                            {isApplied
                              ? <button onClick={() => undo(i)} className="text-xs text-[var(--color-muted)] hover:text-[var(--color-ink)]">↩ undo</button>
                              : <button onClick={() => apply(i)} disabled={!canApply} className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[#0b0d12] disabled:opacity-40">Apply</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="good">Strengths</Badge></h3><ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.strengths.map((s, i) => <li key={i}>• {s}</li>)}</ul></Panel>
                  <Panel className="p-4"><h3 className="mb-2 text-sm font-semibold"><Badge tone="warn">Gaps</Badge></h3><ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.gaps.map((s, i) => <li key={i}>• {s}</li>)}</ul></Panel>
                </div>

                <Panel className="p-4">
                  <h3 className="mb-2 text-sm font-semibold">Impact suggestions</h3>
                  <ul className="space-y-1 text-xs text-[var(--color-muted)]">{review.impact_suggestions.map((s, i) => <li key={i}>• {s}</li>)}</ul>
                  <h3 className="mb-1 mt-3 text-sm font-semibold">ATS &amp; formatting</h3>
                  <p className="text-xs text-[var(--color-muted)]">{review.ats_notes}</p>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

// highlight wraps each occurrence of a mark string in a styled <mark>. Sequential,
// non-overlapping, first-match-wins.
function highlight(text: string, marks: { str: string; cls: string }[]): React.ReactNode[] {
  const targets = marks.filter((m) => m.str && text.includes(m.str));
  const out: React.ReactNode[] = [];
  let rest = text; let key = 0;
  while (rest.length) {
    // find earliest match among targets
    let best = -1; let bestMark: { str: string; cls: string } | null = null;
    for (const m of targets) {
      const idx = rest.indexOf(m.str);
      if (idx >= 0 && (best === -1 || idx < best)) { best = idx; bestMark = m; }
    }
    if (best === -1 || !bestMark) { out.push(<span key={key++}>{rest}</span>); break; }
    if (best > 0) out.push(<span key={key++}>{rest.slice(0, best)}</span>);
    out.push(<mark key={key++} className={`text-[var(--color-ink)] ${bestMark.cls}`}>{bestMark.str}</mark>);
    rest = rest.slice(best + bestMark.str.length);
  }
  return out;
}

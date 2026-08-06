"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { BehavioralSummary, Report } from "@/lib/types";
import { Badge, Button, Panel } from "@/components/ui";
import { Radar } from "@/components/Radar";
import { InfoTip } from "@/components/InfoTip";

const BEHAVIORAL_INFO: Record<string, string> = {
  "Filler words / min": "How often you said 'um, uh, like, you know' per minute, detected from the transcript. Lower is crisper. To improve: pause silently instead of filling gaps — a beat of quiet reads as thoughtful.",
  "Long pauses": "Silences over ~8s where you weren't drawing or speaking. Some thinking time is good; frequent long stalls can read as being stuck. Narrate your thinking as you go.",
  "Help requests": "Times you asked the interviewer for help or a hint. Occasional clarifying is fine; leaning on hints lowers signal. Try stating an assumption and moving on.",
  "Eye contact": "Share of time you looked toward the camera, from in-browser face tracking. To improve: glance at the camera when speaking, not only at your diagram.",
  "Posture": "Stability and upright framing of your upper body, from pose tracking (0–4). Sit up, centered, and avoid drifting out of frame.",
  "Lighting": "Whether your face is well-lit (0–4), from the webcam's brightness. Face a window or light; avoid backlight and darkness.",
  "Framing": "How well-centered and appropriately-sized your face is in frame (0–4). Center yourself with your head+shoulders visible.",
  "Speaking ratio": "Share of the interview you were actively talking. Very low can mean under-communicating your thinking; very high can mean not pausing to let the interviewer probe.",
};

const pretty = (k: string) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const tone = (s: number) => (s >= 3 ? "good" : s >= 2 ? "warn" : "bad") as "good" | "warn" | "bad";
const color = (s: number) => (s >= 3 ? "var(--color-good)" : s >= 2 ? "var(--color-warn)" : "var(--color-bad)");

function ReportInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sid = params.get("s") || "";
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      try { setRep(await api.getReport(sid)); }
      catch (e) { setErr(e instanceof Error ? e.message : "No report"); }
    })();
  }, [router, sid]);

  if (err) return <Centered>{err} · <Button href="/dashboard" variant="ghost">Dashboard</Button></Centered>;
  if (!rep) return <Centered>Loading report…</Centered>;

  // Not enough was said to score fairly — show why instead of fake numbers.
  if (rep.scored === false) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-[var(--color-warn)] text-2xl">–</div>
        <h1 className="mt-5 text-2xl font-bold">Not scored</h1>
        <p className="mx-auto mt-3 max-w-lg text-[var(--color-muted)]">{rep.note || "There wasn't enough in this interview to score fairly."}</p>
        <div className="mt-8 flex justify-center gap-3">
          <Button href="/dashboard">Try another interview →</Button>
        </div>
      </main>
    );
  }

  const assessed = rep.scores.filter((s) => s.assessed !== false);
  const notAssessed = rep.scores.filter((s) => s.assessed === false);
  const b = rep.behavioral as Partial<BehavioralSummary> | undefined;
  const hasBehavioral = !!b && ((b.samples ?? 0) > 0 || !!b.filler_per_min || !!b.help_requests || !!b.long_pauses);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="no-print flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button href="/dashboard" variant="ghost">← Dashboard</Button>
          <Button href="/results" variant="ghost">All results</Button>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="accent">{rep.question_title}</Badge>
          <Button variant="ghost" onClick={() => window.print()}>⬇ Download PDF</Button>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 text-center">
        <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-4" style={{ borderColor: color(rep.overall) }}>
          <div>
            <div className="text-3xl font-extrabold">{rep.overall.toFixed(1)}</div>
            <div className="text-xs text-[var(--color-faint)]">/ 4.0</div>
          </div>
        </div>
        <h1 className="text-2xl font-bold">Interview scorecard</h1>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel className="flex items-center justify-center p-6">
          <Radar data={assessed.map((s) => ({ label: pretty(s.dimension), value: s.score }))} />
        </Panel>
        <div className="grid gap-4">
          <Panel className="p-5">
            <h3 className="mb-3 font-semibold"><Badge tone="good">Strengths</Badge></h3>
            <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">{rep.strengths?.map((s, i) => <li key={i}>• {s}</li>)}</ul>
          </Panel>
          <Panel className="p-5">
            <h3 className="mb-3 font-semibold"><Badge tone="warn">To improve</Badge></h3>
            <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">{rep.gaps?.map((s, i) => <li key={i}>• {s}</li>)}</ul>
          </Panel>
        </div>
      </div>

      {/* Your work — code / notes / diagram summary captured during the interview */}
      {rep.workspace && rep.workspace.trim() && (
        <>
          <h2 className="mt-10 text-xl font-bold">Your work</h2>
          <Panel className="mt-3 overflow-hidden">
            <div className="border-b border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
              {rep.modality === "coding" ? "Your code" : rep.modality === "written" ? "Your written answer" : "Your notes / diagram"}
            </div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap p-5 font-mono text-[13px] leading-relaxed text-[var(--color-ink)]">{rep.workspace}</pre>
          </Panel>
        </>
      )}

      {/* Per-dimension breakdown */}
      <div className="mt-10 flex items-center gap-2">
        <h2 className="text-xl font-bold">Dimension breakdown</h2>
        <InfoTip text="These dimensions are specific to THIS interview type (each question has its own rubric). Each is scored 0–4 from evidence in your transcript and work, weighted, and averaged into the overall. Dimensions you didn't address are marked 'not assessed' rather than guessed." />
      </div>
      {notAssessed.length > 0 && (
        <p className="mt-1 text-sm text-[var(--color-faint)]">Not assessed (too little said): {notAssessed.map((s) => pretty(s.dimension)).join(", ")}.</p>
      )}
      <div className="mt-4 space-y-3">
        {assessed.map((s) => (
          <Panel key={s.dimension} className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="font-semibold">{pretty(s.dimension)}</div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-[var(--color-faint)]">coverage {s.coverage_pct}%</span>
                <Badge tone={tone(s.score)}>{s.score.toFixed(1)} / 4</Badge>
              </div>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--color-panel-2)]">
              <div className="h-full rounded-full" style={{ width: `${(s.score / 4) * 100}%`, background: color(s.score) }} />
            </div>
            {(s.expected || s.actual) && (
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                {s.expected && <div><div className="text-xs font-medium text-[var(--color-faint)]">EXPECTED</div><div className="text-[var(--color-muted)]">{s.expected}</div></div>}
                {s.actual && <div><div className="text-xs font-medium text-[var(--color-faint)]">ACTUAL</div><div className="text-[var(--color-muted)]">{s.actual}</div></div>}
              </div>
            )}
            {s.evidence && <div className="mt-2 text-sm italic text-[var(--color-faint)]">“{s.evidence}”</div>}
          </Panel>
        ))}
      </div>

      {/* Behavioral */}
      {hasBehavioral && b && (
        <>
          <div className="mt-10 flex items-center gap-2">
            <h2 className="text-xl font-bold">Presence &amp; delivery</h2>
            <InfoTip text="Measured in your browser (nothing leaves your device except the summary): filler words + pauses from the transcript, and eye contact, posture, lighting, and framing from webcam face/pose tracking. These don't affect your technical score — they're how you came across. Hover any tile for how to improve it." />
          </div>
          <p className="mt-1 text-sm text-[var(--color-faint)]">Observed signals — not right/wrong, but how you came across.</p>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Filler words / min" value={b.filler_per_min ?? 0} />
            <Metric label="Long pauses" value={b.long_pauses ?? 0} />
            <Metric label="Help requests" value={b.help_requests ?? 0} />
            <Metric label="Eye contact" value={`${b.eye_contact_pct ?? 0}%`} />
            <Metric label="Posture" value={`${(b.posture_score ?? 0).toFixed(1)}/4`} />
            <Metric label="Lighting" value={`${(b.lighting_score ?? 0).toFixed(1)}/4`} />
            <Metric label="Framing" value={`${(b.framing_score ?? 0).toFixed(1)}/4`} />
            <Metric label="Speaking ratio" value={`${Math.round((b.speaking_ratio ?? 0) * 100)}%`} />
          </div>
        </>
      )}

      {/* Coaching */}
      {rep.coaching_md && (
        <Panel className="mt-10 p-6">
          <h2 className="text-xl font-bold">Coaching</h2>
          <Markdown md={rep.coaching_md} />
        </Panel>
      )}

      <div className="mt-8 flex justify-center">
        <Button href="/dashboard">Practice another →</Button>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <Panel className="p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--color-faint)]">
        {label}
        {BEHAVIORAL_INFO[label] && <InfoTip text={BEHAVIORAL_INFO[label]} />}
      </div>
    </Panel>
  );
}

// Minimal markdown: ## headings, - bullets, **bold**, blank-line paragraphs.
function Markdown({ md }: { md: string }) {
  const lines = md.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) { out.push(<ul key={out.length} className="my-2 space-y-1 pl-1">{list.map((l, i) => <li key={i} className="text-[var(--color-muted)]">• {bold(l)}</li>)}</ul>); list = []; }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) { flush(); out.push(<h3 key={out.length} className="mt-4 font-semibold">{line.slice(3)}</h3>); }
    else if (/^[-*]\s|^\d+\.\s/.test(line)) { list.push(line.replace(/^[-*]\s|^\d+\.\s/, "")); }
    else if (line) { flush(); out.push(<p key={out.length} className="my-2 text-[var(--color-muted)]">{bold(line)}</p>); }
  }
  flush();
  return <div className="mt-2 text-sm">{out}</div>;
}
function bold(s: string): React.ReactNode {
  return s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") ? <strong key={i} className="text-[var(--color-ink)]">{p.slice(2, -2)}</strong> : p));
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center gap-2 text-[var(--color-muted)]">{children}</main>;
}

export default function ReportPage() {
  return <Suspense fallback={<Centered>Loading…</Centered>}><ReportInner /></Suspense>;
}

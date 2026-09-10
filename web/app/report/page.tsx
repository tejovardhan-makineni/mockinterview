"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type {
  Report,
  ProcessingReport,
  Session,
  TranscriptTurn,
} from "@/lib/features/interview";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Panel, ErrorNotice } from "@/components/ui";
import { PersonalKeyRecovery } from "@/components/PersonalKeyRecovery";
import { FeedbackWidget } from "@/components/FeedbackWidget";
const pretty = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function ReportView() {
  const router = useRouter();
  const params = useSearchParams();
  const sid = params.get("s") ?? "";
  const [report, setReport] = useState<Report | null>(null);
  const [processing, setProcessing] = useState<ProcessingReport | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = await api.getReport(sid);
        if (cancelled) return;
        if ("status" in result) {
          setProcessing(result);
          if (result.status === "scoring")
            timer = setTimeout(() => void poll(), 2000);
        } else {
          setReport(result);
          setProcessing(null);
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    };
    (async () => {
      try {
        const user = await api.me();
        if (cancelled) return;
        if (!user) {
          router.replace(
            "/login?next=" + encodeURIComponent("/report?s=" + sid),
          );
          return;
        }
        const [s, t] = await Promise.all([
          api.getSession(sid),
          api.getTranscript(sid),
        ]);
        if (cancelled) return;
        setSession(s);
        setTurns(t);
        await poll();
      } catch (e) {
        if (!cancelled) setError(errorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sid, router, retry]);
  async function retryScoring() {
    setBusy(true);
    setError("");
    try {
      await api.finishSession(sid);
      setProcessing({ status: "scoring" });
      setRetry((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function exportReport() {
    const blob = new Blob(
      [JSON.stringify({ report, session, transcript: turns }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "interview-" + sid + ".json";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <AppShell active="results">
      <a href="/results" className="text-sm text-[var(--color-muted)]">
        ← Your history
      </a>
      {error && (
        <div className="my-5">
          <ErrorNotice
            message={error}
            onRetry={() => {
              setError("");
              setRetry((n) => n + 1);
            }}
          />
        </div>
      )}
      {!report ? (
        <Panel className="mx-auto mt-10 max-w-2xl p-8">
          <p className="eyebrow">
            {session ? "Your interview is saved" : "Loading your interview"}
          </p>
          <h1 className="mt-3 text-2xl font-medium">
            {processing?.status === "feedback_failed"
              ? "Feedback needs another try."
              : "Preparing your next steps."}
          </h1>
          <p className="mt-4 text-sm text-[var(--color-muted)]" role="status">
            {processing?.status === "feedback_failed"
              ? processing.error ||
                "The report could not be completed. Retry uses the same saved interview and does not consume another attempt."
              : session
                ? "Your saved answers and work are being reviewed. You can leave this page and return from History."
                : "Loading the saved record. If the service is unavailable, retry or return to History."}
          </p>
          {processing?.status === "feedback_failed" &&
            session?.funding === "byok" && (
              <div className="mt-4">
                <PersonalKeyRecovery sessionId={sid} onSaved={retryScoring} />
              </div>
            )}
          {processing?.status === "feedback_failed" && (
            <Button
              className="mt-5"
              disabled={busy}
              onClick={() => void retryScoring()}
            >
              {busy ? "Retrying…" : "Retry feedback"}
            </Button>
          )}
          <Button href="/results" variant="ghost" className="ml-3 mt-5">
            Back to history
          </Button>
        </Panel>
      ) : (
        <>
          <div className="mt-7 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow">A clearer next step</p>
              <h1 className="page-title mt-3">
                {report.scored === false
                  ? "Keep going. There’s more to learn."
                  : "Know what to practice next."}
              </h1>
              <p className="mt-3 text-[var(--color-muted)]">
                {report.question_title}
              </p>
            </div>
            <div className="no-print flex gap-2">
              <Button variant="ghost" onClick={() => window.print()}>
                Print / save PDF
              </Button>
              <Button variant="ghost" onClick={exportReport}>
                Export record
              </Button>
            </div>
          </div>
          {report.scored === false ? (
            <p className="notice mt-6">
              {report.note ??
                "There was not enough evidence to score this attempt fairly. Your transcript and work are still saved below."}
            </p>
          ) : (
            <div className="mt-7 grid gap-5 md:grid-cols-2">
              <Panel className="p-6">
                <p className="eyebrow">Keep doing</p>
                <h2 className="mt-3 text-xl font-medium">What worked</h2>
                <ul className="mt-4 space-y-3">
                  {report.strengths?.map((x, i) => (
                    <li
                      key={i}
                      className="text-sm leading-relaxed text-[var(--color-muted)]"
                    >
                      {x}
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel className="p-6">
                <p className="eyebrow">A little more attention</p>
                <h2 className="mt-3 text-xl font-medium">
                  Your next improvements
                </h2>
                <ol className="mt-4 space-y-3">
                  {report.gaps?.slice(0, 3).map((x, i) => (
                    <li
                      key={i}
                      className="text-sm leading-relaxed text-[var(--color-muted)]"
                    >
                      {i + 1}. {x}
                    </li>
                  ))}
                </ol>
              </Panel>
            </div>
          )}
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
            <div className="space-y-4">
              <Panel className="p-6">
                <details open>
                  <summary className="font-semibold">
                    Evidence behind the feedback
                  </summary>
                  <div className="mt-5 space-y-5">
                    {report.scores?.map((score) => (
                      <div
                        key={score.dimension}
                        className="border-t border-[var(--color-line)] pt-4"
                      >
                        <div className="flex items-center justify-between gap-4">
                          <h3 className="text-sm font-semibold">
                            {pretty(score.dimension)}
                          </h3>
                          <Badge>
                            {score.assessed === false
                              ? "Not assessed"
                              : score.score.toFixed(1) + " / 4"}
                          </Badge>
                        </div>
                        {score.assessed !== false && (
                          <>
                            <p className="mt-2 text-sm text-[var(--color-muted)]">
                              {score.actual}
                            </p>
                            {score.evidence && (
                              <blockquote className="mt-3 border-l-2 border-[var(--color-accent)] pl-3 text-sm text-[var(--color-muted)]">
                                {score.evidence}
                              </blockquote>
                            )}
                            {score.expected && (
                              <p className="mt-3 text-xs text-[var(--color-muted)]">
                                Next time: {score.expected}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </Panel>
              <Panel className="p-6">
                <details>
                  <summary className="font-semibold">
                    Full transcript · {turns.length} turns
                  </summary>
                  <div className="mt-5 max-h-[60vh] space-y-5 overflow-auto">
                    {turns.map((turn, i) => (
                      <div key={i}>
                        <p className="text-xs font-semibold">
                          {turn.role === "candidate"
                            ? "You"
                            : turn.role === "interviewer"
                              ? "Interviewer"
                              : "System"}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-muted)]">
                          {turn.text}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </Panel>
              <Panel className="p-6">
                <details>
                  <summary className="font-semibold">
                    Saved work & interview settings
                  </summary>
                  <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap text-sm">
                    {session?.workspace?.content ||
                      report.workspace ||
                      "No workspace content was added."}
                  </pre>
                  <p className="mt-4 text-xs text-[var(--color-muted)]">
                    {pretty(session?.config.target_level ?? "mid")} ·{" "}
                    {pretty(session?.config.challenge ?? "standard")} ·{" "}
                    {session?.duration_minutes} minutes ·{" "}
                    {session?.provider || "Configured provider"}{" "}
                    {session?.model} · Scoring version{" "}
                    {report.scoring_version ?? "original"}
                  </p>
                </details>
              </Panel>
            </div>
            <aside className="space-y-5">
              {(report.learning_drills ?? []).slice(0, 2).map((drill) => (
                <Panel key={drill.id} className="p-6">
                  <p className="eyebrow">
                    {drill.minutes} minutes · no model needed
                  </p>
                  <h2 className="mt-3 text-lg font-semibold">{drill.title}</h2>
                  <p className="mt-3 text-sm text-[var(--color-muted)]">
                    {drill.prompt}
                  </p>
                  <ul className="mt-4 space-y-2 text-xs text-[var(--color-muted)]">
                    {drill.checklist.map((x) => (
                      <li key={x}>• {x}</li>
                    ))}
                  </ul>
                  <label className="mt-4 block text-xs">
                    Try it now
                    <textarea
                      rows={4}
                      className="field-select mt-2"
                      placeholder="Notes for this exercise — not saved"
                    />
                  </label>
                </Panel>
              ))}
              <Panel className="p-6">
                <h2 className="font-semibold">
                  Help improve the next interview.
                </h2>
                <p className="my-3 text-sm text-[var(--color-muted)]">
                  Two optional questions. A rating is enough.
                </p>
                <div className="flex flex-col gap-3">
                  <FeedbackWidget
                    target="interviewer"
                    sessionId={sid}
                    label="Did the interviewer feel realistic?"
                  />
                  <FeedbackWidget
                    target="product"
                    sessionId={sid}
                    label="How was the product experience?"
                  />
                </div>
              </Panel>
              <Button href="/interviews" variant="ghost" className="w-full">
                Explore your next practice →
              </Button>
            </aside>
          </div>
          <p className="mt-7 text-xs text-[var(--color-muted)]">
            AI practice feedback can be incomplete or mistaken. Unassessed
            dimensions are not zeroes. Camera presence and appearance do not
            contribute to these scores.
          </p>
        </>
      )}
    </AppShell>
  );
}
export default function ReportPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading feedback…</p>}>
      <ReportView />
    </Suspense>
  );
}

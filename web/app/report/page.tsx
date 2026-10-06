"use client";
import { levelLabel, roleTrackLabel } from "@/lib/roleScope";
import { providerName } from "@/lib/providers";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { syncAnalytics } from "@/lib/analytics";
import { api } from "@/lib/api";
import type {
  Report,
  ProcessingReport,
  Session,
  TranscriptTurn,
} from "@/lib/features/interview";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Button, Panel, ErrorNotice } from "@/components/ui";
import { PersonalKeyRecovery } from "@/components/PersonalKeyRecovery";
import { InterviewFeedbackDialog } from "@/components/InterviewFeedbackDialog";
import {
  IconClock,
  IconFeedback,
  IconResults,
  IconResume,
  IconThinking,
} from "@/components/icons";
import { ScoreRing } from "@/components/results/ScoreRing";
import styles from "./report.module.css";
const pretty = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
function ReportView({ sid }: { sid: string }) {
  const router = useRouter();
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
  useEffect(() => {
    if (report || processing?.status === "feedback_failed")
      void api
        .me()
        .then((user) => {
          if (user) void syncAnalytics(user.id);
        })
        .catch(() => {});
  }, [report, processing?.status]);
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
  const scored = report?.scored !== false;
  const dimensions = report?.scores ?? [];
  const assessedCount = dimensions.filter(
    (score) => score.assessed !== false,
  ).length;
  const overallAssessed =
    scored && (dimensions.length === 0 || assessedCount > 0);
  const drills = (report?.learning_drills ?? []).slice(0, 2);
  return (
    <AppShell active="results" feedbackSessionId={session?.id}>
      <div className={styles.report}>
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <a href="/results" className={styles.backLink}>
            ← Your history
          </a>
          {session && (
            <InterviewFeedbackDialog
              key={sid}
              sessionId={sid}
              reportAvailable={!!report}
            />
          )}
        </div>
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
          <Panel className={styles.preparing}>
            <span className={styles.iconTile}>
              <IconThinking />
            </span>
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
                  <PersonalKeyRecovery
                    sessionId={sid}
                    provider={session.provider}
                    onSaved={retryScoring}
                  />
                </div>
              )}
            <div className={styles.preparingActions}>
              {processing?.status === "feedback_failed" && (
                <Button disabled={busy} onClick={() => void retryScoring()}>
                  {busy ? "Retrying…" : "Retry feedback"}
                </Button>
              )}
              <Button href="/results" variant="ghost">
                Back to history
              </Button>
            </div>
          </Panel>
        ) : (
          <>
            <section
              id="report-summary"
              className={styles.hero}
              aria-labelledby="recap-heading"
            >
              <div className={styles.heroCopy}>
                <p className={styles.eyebrow}>
                  <IconResults /> Your interview recap
                </p>
                <h1 id="recap-heading">
                  A little practice.
                  <br />
                  <span>A clearer next step.</span>
                </h1>
                <p className={styles.questionTitle}>{report.question_title}</p>
                <div className={styles.meta}>
                  {(session?.modality || report.modality) && (
                    <span>
                      {pretty(session?.modality || report.modality || "")}
                    </span>
                  )}
                  {session?.duration_minutes != null && (
                    <span>
                      <IconClock /> {session.duration_minutes}-minute session
                    </span>
                  )}
                  {scored && dimensions.length > 0 && (
                    <span>
                      {assessedCount} of {dimensions.length} areas assessed
                    </span>
                  )}
                </div>
              </div>
              <div className={styles.scoreSpotlight}>
                <span className={styles.orbitStar} aria-hidden="true">
                  ✦
                </span>
                <ScoreRing score={report.overall} assessed={overallAssessed} />
                <p>
                  {overallAssessed &&
                  Number.isFinite(report.overall) &&
                  report.overall >= 0 &&
                  report.overall <= 4
                    ? "Your practice score"
                    : "Your practice is saved"}
                </p>
                <span>A starting point for your next step.</span>
              </div>
            </section>
            <div className={styles.toolbar}>
              <p>Keep what worked. Build on the rest.</p>
              <div className="no-print flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => window.print()}>
                  Print / save PDF
                </Button>
                <Button variant="ghost" onClick={exportReport}>
                  Export record
                </Button>
              </div>
            </div>
            {!scored ? (
              <div className={styles.unscored}>
                <IconResume />
                <div>
                  <h2>A saved attempt, without a score</h2>
                  <p>
                    {report.note ??
                      "There was not enough evidence to score this attempt fairly. Your transcript and work are still saved below."}
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className={styles.highlights}>
                  <section
                    className={styles.strengths}
                    aria-labelledby="strengths-heading"
                  >
                    <div className={styles.cardHeading}>
                      <span className={styles.iconTile} aria-hidden="true">
                        ✦
                      </span>
                      <div>
                        <p className={styles.eyebrow}>Keep this energy</p>
                        <h2 id="strengths-heading">What worked</h2>
                      </div>
                    </div>
                    {report.strengths?.length ? (
                      <ul className={styles.feedbackList}>
                        {report.strengths.map((item, i) => (
                          <li key={i}>
                            <span
                              className={styles.listMark}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                            <p>{item}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.emptyNote}>
                        No specific strengths were recorded for this attempt.
                        Review the evidence below for more context.
                      </p>
                    )}
                  </section>
                  <section
                    className={styles.improvements}
                    aria-labelledby="improvements-heading"
                  >
                    <div className={styles.cardHeading}>
                      <span className={styles.iconTile}>
                        <IconResults />
                      </span>
                      <div>
                        <p className={styles.eyebrow}>Your next move</p>
                        <h2 id="improvements-heading">Room to grow</h2>
                      </div>
                    </div>
                    {report.gaps?.length ? (
                      <ol className={styles.feedbackList}>
                        {report.gaps.slice(0, 3).map((item, i) => (
                          <li key={i}>
                            <span
                              className={styles.listMark}
                              aria-hidden="true"
                            >
                              {i + 1}
                            </span>
                            <p>{item}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className={styles.emptyNote}>
                        No specific improvements were recorded. Use the detailed
                        feedback to choose your next practice focus.
                      </p>
                    )}
                  </section>
                </div>
                {dimensions.length > 0 && (
                  <section
                    className={styles.skills}
                    aria-labelledby="skills-heading"
                  >
                    <div className={styles.sectionHeading}>
                      <div>
                        <p className={styles.eyebrow}>The bigger picture</p>
                        <h2 id="skills-heading">Your skill snapshot</h2>
                      </div>
                      <p>Select an area to see the evidence.</p>
                    </div>
                    <div className={styles.skillGrid}>
                      {dimensions.map((score, i) => {
                        const available =
                          score.assessed !== false &&
                          Number.isFinite(score.score) &&
                          score.score >= 0 &&
                          score.score <= 4;
                        return (
                          <a
                            key={score.dimension}
                            className={styles.skillCard}
                            data-tone={i % 4}
                            href={"#dimension-" + i}
                            onClick={() =>
                              document
                                .getElementById("dimension-" + i)
                                ?.closest("details")
                                ?.setAttribute("open", "")
                            }
                          >
                            <span className={styles.skillName}>
                              {pretty(score.dimension)}
                            </span>
                            <span className={styles.skillValue}>
                              {available ? (
                                <>
                                  <strong>{score.score.toFixed(1)}</strong>
                                  <span> / 4</span>
                                </>
                              ) : (
                                <span className={styles.notAssessed}>
                                  {score.assessed === false
                                    ? "Not assessed"
                                    : "Score unavailable"}
                                </span>
                              )}
                            </span>
                            <span
                              className={styles.skillTrack}
                              aria-hidden="true"
                            >
                              {available && (
                                <span
                                  style={{
                                    width: `${(score.score / 4) * 100}%`,
                                  }}
                                />
                              )}
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
            <div className={styles.detailGrid}>
              <div className={styles.evidenceColumn}>
                <Panel className={styles.evidencePanel}>
                  <details open>
                    <summary className={styles.detailSummary}>
                      <span className={styles.summaryContent}>
                        <IconFeedback /> Evidence behind the feedback
                      </span>
                    </summary>
                    <div className={styles.evidenceList}>
                      {dimensions.length ? (
                        dimensions.map((score, i) => {
                          const available =
                            scored &&
                            score.assessed !== false &&
                            Number.isFinite(score.score) &&
                            score.score >= 0 &&
                            score.score <= 4;
                          return (
                            <div
                              key={score.dimension}
                              id={"dimension-" + i}
                              className={styles.evidenceItem}
                            >
                              <div className={styles.evidenceTitle}>
                                <h3>{pretty(score.dimension)}</h3>
                                <span className={styles.scoreBadge}>
                                  {available
                                    ? score.score.toFixed(1) + " / 4"
                                    : !scored || score.assessed === false
                                      ? "Not assessed"
                                      : "Score unavailable"}
                                </span>
                              </div>
                              {scored && score.assessed !== false && (
                                <>
                                  {score.actual && (
                                    <p className={styles.actual}>
                                      {score.actual}
                                    </p>
                                  )}
                                  {score.evidence && (
                                    <blockquote>{score.evidence}</blockquote>
                                  )}
                                  {score.expected && (
                                    <p className={styles.nextTime}>
                                      <strong>Next time</strong>
                                      {score.expected}
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <p className={styles.emptyNote}>
                          No dimension-level feedback was recorded for this
                          attempt. Your saved transcript and work are available
                          below.
                        </p>
                      )}
                    </div>
                  </details>
                </Panel>
                <Panel className={styles.archivePanel}>
                  <details>
                    <summary className={styles.detailSummary}>
                      <span className={styles.summaryContent}>
                        <IconFeedback /> Full transcript{" "}
                        <span className={styles.turnCount}>
                          {turns.length} turns
                        </span>
                      </span>
                    </summary>
                    <div
                      className={styles.transcript}
                      role="region"
                      aria-label="Saved interview transcript"
                      tabIndex={0}
                    >
                      {turns.length ? (
                        turns.map((turn, i) => (
                          <div
                            key={i}
                            className={styles.turn}
                            data-candidate={turn.role === "candidate"}
                          >
                            <p className={styles.turnRole}>
                              {turn.role === "candidate"
                                ? "You"
                                : turn.role === "interviewer"
                                  ? "Interviewer"
                                  : "System"}
                            </p>
                            <p>{turn.text}</p>
                          </div>
                        ))
                      ) : (
                        <p className={styles.emptyNote}>
                          No transcript was recorded for this attempt.
                        </p>
                      )}
                    </div>
                  </details>
                </Panel>
                <Panel className={styles.archivePanel}>
                  <details>
                    <summary className={styles.detailSummary}>
                      <span className={styles.summaryContent}>
                        <IconResume /> Saved work & interview settings
                      </span>
                    </summary>
                    <pre
                      className={styles.savedWork}
                      tabIndex={0}
                      aria-label="Saved interview workspace"
                    >
                      {session?.workspace?.content ||
                        report.workspace ||
                        "No workspace content was added."}
                    </pre>
                    <p className={styles.settings}>
                      {session?.config.role_track && (
                        <>{roleTrackLabel(session.config.role_track)} · </>
                      )}
                      {levelLabel(
                        session?.config.target_level ??
                          session?.question?.difficulty ??
                          "mid",
                      )}{" "}
                      · {pretty(session?.config.challenge ?? "standard")} ·{" "}
                      {session?.duration_minutes} minutes ·{" "}
                      {session?.provider
                        ? providerName(session.provider)
                        : "Configured provider"}{" "}
                      {session?.model} · Scoring version{" "}
                      {report.scoring_version ?? "original"}
                    </p>
                  </details>
                </Panel>
              </div>
              <aside
                className={styles.practiceColumn}
                aria-label="Your next practice"
              >
                {drills.length > 0 && (
                  <div className={styles.practiceHeading}>
                    <span className={styles.iconTile}>
                      <IconThinking />
                    </span>
                    <div>
                      <p className={styles.eyebrow}>Put it into practice</p>
                      <h2>Your next small wins</h2>
                    </div>
                  </div>
                )}
                {drills.map((drill, i) => (
                  <section key={drill.id} className={styles.drill}>
                    <div className={styles.drillTop}>
                      <span className={styles.drillNumber}>
                        Practice {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <IconClock /> {drill.minutes} min
                      </span>
                    </div>
                    <h3>{drill.title}</h3>
                    <p className={styles.drillPrompt}>{drill.prompt}</p>
                    <ul className={styles.checklist}>
                      {drill.checklist.map((item) => (
                        <li key={item}>
                          <span aria-hidden="true">◇</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                    <label className={styles.drillNotes}>
                      Try it now
                      <textarea
                        rows={4}
                        className="field-select mt-2"
                        placeholder="Notes for this exercise — not saved"
                      />
                    </label>
                    <p className={styles.drillFootnote}>
                      A quick exercise. No model needed.
                    </p>
                  </section>
                ))}
                <div className={styles.nextPractice}>
                  <span aria-hidden="true">↗</span>
                  <h2>Keep the momentum.</h2>
                  <p>Bring one thing you learned into your next interview.</p>
                  <Button href="/interviews" className={styles.practiceButton}>
                    Choose your next practice →
                  </Button>
                </div>
              </aside>
            </div>
            <p className={styles.disclaimer}>
              AI practice feedback can be incomplete or mistaken. Unassessed
              dimensions are not zeroes. Camera presence and appearance do not
              contribute to these scores.
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
function ReportRoute() {
  const sid = useSearchParams().get("s") ?? "";
  return <ReportView key={sid} sid={sid} />;
}
export default function ReportPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading feedback…</p>}>
      <ReportRoute />
    </Suspense>
  );
}

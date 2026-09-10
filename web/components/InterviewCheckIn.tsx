"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { api, IS_MOCK } from "@/lib/api";
import {
  COMPARISON_VERSION,
  ToolComparisonFields,
  ToolComparisonSummary,
  comparisonTooLong,
} from "./ToolComparison";
import type {
  ToolComparison,
  InterviewFeedbackEnvelope,
} from "@/lib/features/feedback";
import { completeFeedback } from "@/lib/interviewFeedback";
import { errorMessage } from "@/lib/http";
import { Button, ErrorNotice, Panel } from "./ui";
import { feedbackChanged } from "./RequiredFeedbackNotice";

export function InterviewCheckIn({
  sessionId,
  reportAvailable = false,
  showIneligible = false,
  onEligibilityChange,
}: {
  sessionId: string;
  reportAvailable?: boolean;
  showIneligible?: boolean;
  onEligibilityChange?: (eligible: boolean) => void;
}) {
  const [envelope, setEnvelope] = useState<InterviewFeedbackEnvelope | null>(
    null,
  );
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [comparison, setComparison] = useState<ToolComparison | null>(null);
  const [comment, setComment] = useState("");
  const [share, setShare] = useState(false);
  const [editing, setEditing] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const commentLength = Array.from(comment).length;
  const commentTooLong = commentLength > 2000;
  const supportsComparison =
    envelope?.questionnaire.comparison_version === COMPARISON_VERSION;
  const invalidComparison = supportsComparison && comparisonTooLong(comparison);
  const submitting = useRef(false);
  const prefix = useId();
  useEffect(() => {
    let alive = true;
    api
      .getInterviewFeedback(sessionId)
      .then((value) => {
        if (!alive) return;
        setEnvelope(value);
        onEligibilityChange?.(value.eligible);
        setAnswers(value.response?.answers ?? {});
        setComment(value.response?.comment ?? "");
        setComparison(value.response?.comparison ?? null);
        setShare(value.response?.share_transcript ?? false);
        setEditing(!value.response);
        setDirty(false);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [sessionId, reload, onEligibilityChange]);
  // During the ending drain the report page can arrive before eligibility is
  // committed. Retry only new, unfinished check-ins; never replace an editable draft.
  useEffect(() => {
    if (
      !envelope ||
      envelope.eligible ||
      !envelope.feedback_version ||
      !["active", "interrupted", "ending"].includes(
        envelope.session_status ?? "",
      ) ||
      IS_MOCK
    )
      return;
    const timer = window.setTimeout(() => setReload((n) => n + 1), 2000);
    return () => window.clearTimeout(timer);
  }, [envelope]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function submit() {
    if (
      !envelope ||
      !completeFeedback(envelope, answers) ||
      commentTooLong ||
      invalidComparison ||
      submitting.current
    )
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const next = await api.saveInterviewFeedback(sessionId, {
        version: envelope.questionnaire.version,
        answers,
        comment,
        share_transcript: share,
        ...(supportsComparison ? { comparison } : {}),
      });
      if (!next.response)
        throw new Error(
          "The server did not confirm your responses. Your answers are still on this page; retry saving.",
        );
      setEnvelope(next);
      setAnswers(next.response.answers);
      setComment(next.response.comment ?? "");
      setComparison(next.response.comparison ?? null);
      setShare(next.response.share_transcript ?? false);
      setDirty(false);
      setEditing(false);
      setSaved(true);
      feedbackChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  if (!envelope)
    return (
      <Panel className="no-print mt-7 p-6">
        {error ? (
          <ErrorNotice
            message={
              "Check-in could not load. Your report remains available. " + error
            }
            onRetry={() => setReload((n) => n + 1)}
          />
        ) : (
          <p role="status">Loading your interview check-in…</p>
        )}
      </Panel>
    );
  if (!envelope.eligible && error)
    return (
      <div className="mt-6">
        <ErrorNotice
          message={"Check-in status could not refresh. " + error}
          onRetry={() => setReload((n) => n + 1)}
        />
      </div>
    );
  if (!envelope.eligible)
    return IS_MOCK ? (
      <p className="notice mt-6 text-sm">
        Demo mode: interview check-ins are not sent or saved.
      </p>
    ) : showIneligible ? (
      <p className="notice mt-6 text-sm">
        {envelope.feedback_version
          ? "Your check-in becomes available after this interview ends. Unused reservations do not require a check-in."
          : "No check-in is required for this interview. Interviews from before this questionnaire are excluded."}
      </p>
    ) : null;
  const questions = envelope.questionnaire.questions;
  const answered = questions.filter((q) =>
    q.options.some((o) => o.value === answers[q.id]),
  ).length;
  const hasReport = reportAvailable || envelope.report_available;
  return (
    <Panel className="no-print mt-7 p-6">
      <section aria-labelledby={prefix + "-heading"} id="interview-check-in">
        <p className="eyebrow">Improve your next practice</p>
        <h2 className="mt-2 text-xl font-semibold" id={prefix + "-heading"}>
          Your interview check-in
        </h2>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          {envelope.required
            ? "A short required check-in before your next interview. Your report and account controls remain available."
            : "Your check-in is saved. Editing it is optional."}{" "}
          Your responses are saved to your account for product improvement.
          Choose “Unable to judge” when you cannot rate an item.
        </p>
        <p className="mt-2 text-sm">
          Subject: {envelope.questionnaire.subject_label} ·{" "}
          {hasReport ? (
            <Link
              className="underline"
              href={
                reportAvailable
                  ? "#report-summary"
                  : "/report?s=" + encodeURIComponent(sessionId)
              }
              target={reportAvailable ? undefined : "_blank"}
              rel={reportAvailable ? undefined : "noopener"}
            >
              Read your report{reportAvailable ? "" : " (new tab)"}
            </Link>
          ) : (
            "Your report is not available yet. You can say so in the report question and update it later."
          )}
        </p>
        {saved && (
          <p className="notice mt-4" role="status">
            Check-in saved to your account. Thank you. Your usual interview
            allowance still applies.
          </p>
        )}
        {!editing ? (
          <>
            <dl className="mt-5 space-y-4">
              {questions.map((q) => (
                <div key={q.id}>
                  <dt className="text-sm font-medium">{q.prompt}</dt>
                  <dd className="mt-1 text-sm text-[var(--color-muted)]">
                    {q.options.find((o) => o.value === answers[q.id])?.label ??
                      "Not answered"}
                  </dd>
                </div>
              ))}
            </dl>
            {supportsComparison && <ToolComparisonSummary value={comparison} />}
            {comment && (
              <p className="mt-4 whitespace-pre-wrap break-words text-sm">
                {comment}
              </p>
            )}
            <p className="mt-3 text-xs">
              Transcript inspection permission:{" "}
              {share ? "allowed" : "not given"}. Saved{" "}
              {new Date(envelope.response!.updated_at).toLocaleString()}.
            </p>
            <Button
              className="mt-4"
              variant="ghost"
              onClick={() => {
                setEditing(true);
                setSaved(false);
              }}
            >
              Edit responses (optional)
            </Button>
          </>
        ) : (
          <form
            className="mt-6 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {questions.map((q, index) => (
              <fieldset
                key={q.id}
                disabled={busy}
                className="min-w-0 border-t border-[var(--color-line)] pt-5"
              >
                <legend className="max-w-full text-sm font-semibold">
                  {index + 1}. {q.prompt}{" "}
                  <span className="text-xs font-normal">(required)</span>
                </legend>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {q.options.map((o) => (
                    <label
                      className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-line)] p-3 text-sm has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-panel-2)]"
                      key={o.value}
                    >
                      <input
                        className="mt-1 shrink-0"
                        type="radio"
                        required
                        name={prefix + q.id}
                        value={o.value}
                        checked={answers[q.id] === o.value}
                        onChange={() => {
                          setAnswers((a) => ({ ...a, [q.id]: o.value }));
                          setDirty(true);
                          setSaved(false);
                        }}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {supportsComparison && (
              <ToolComparisonFields
                value={comparison}
                disabled={busy}
                onChange={(value) => {
                  setComparison(value);
                  setDirty(true);
                  setSaved(false);
                }}
              />
            )}
            <label className="block text-sm" htmlFor={prefix + "-comment"}>
              What should we improve first? (optional)
              <textarea
                id={prefix + "-comment"}
                rows={3}
                disabled={busy}
                value={comment}
                onChange={(e) => {
                  setComment(e.target.value);
                  setDirty(true);
                }}
                className="field-select mt-2"
                aria-describedby={
                  prefix + "-privacy " + prefix + "-comment-length"
                }
                aria-invalid={commentTooLong || undefined}
              />
            </label>
            <p
              id={prefix + "-comment-length"}
              role={commentTooLong ? "alert" : undefined}
              className="text-xs"
            >
              {commentLength} / 2,000 characters
              {commentTooLong
                ? ". Shorten your optional comment before saving; your text has been kept."
                : ""}
            </p>
            <p
              className="text-xs text-[var(--color-muted)]"
              id={prefix + "-privacy"}
            >
              Avoid personal, confidential or identifying information. No
              comment, diagnostics, research participation or transcript access
              is required.
            </p>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={share}
                disabled={busy}
                onChange={(e) => {
                  setShare(e.target.checked);
                  setDirty(true);
                }}
              />
              <span>
                Allow maintainers to inspect this interview’s transcript to
                investigate my feedback (optional).{" "}
                <Link href="/privacy" className="underline">
                  Privacy details
                </Link>
              </span>
            </label>
            {error && (
              <ErrorNotice
                message={
                  error +
                  " Your unsaved answers remain on this page. Retry saving."
                }
              />
            )}
            <p role="status" className="text-xs">
              {answered} of {questions.length} required questions answered.
              {dirty
                ? " Unsaved changes — leaving or reloading may discard them."
                : ""}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                disabled={
                  busy ||
                  commentTooLong ||
                  invalidComparison ||
                  !completeFeedback(envelope, answers)
                }
              >
                {busy
                  ? "Saving…"
                  : error
                    ? "Retry saving check-in"
                    : "Save check-in"}
              </Button>
              {envelope.response && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setAnswers(envelope.response!.answers);
                    setComment(envelope.response!.comment ?? "");
                    setComparison(envelope.response!.comparison ?? null);
                    setShare(envelope.response!.share_transcript ?? false);
                    setDirty(false);
                    setEditing(false);
                    setError("");
                  }}
                >
                  Cancel edits
                </Button>
              )}
            </div>
          </form>
        )}
      </section>
    </Panel>
  );
}

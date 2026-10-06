"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { IS_DESKTOP } from "@/lib/desktop";
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

export type InterviewCheckInStatus =
  "loading" | "pending" | "submitted" | "unavailable" | "ineligible";

export function InterviewCheckIn({
  sessionId,
  reportAvailable = false,
  compact = reportAvailable,
  showIneligible = false,
  onEligibilityChange,
  embedded = false,
  onStatusChange,
  onReadReport,
}: {
  sessionId: string;
  reportAvailable?: boolean;
  compact?: boolean;
  showIneligible?: boolean;
  onEligibilityChange?: (eligible: boolean) => void;
  embedded?: boolean;
  onStatusChange?: (status: InterviewCheckInStatus) => void;
  onReadReport?: () => void;
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
  const [expanded, setExpanded] = useState(!compact);
  const [reload, setReload] = useState(0);
  const commentLength = Array.from(comment).length;
  const commentTooLong = commentLength > 2000;
  const supportsComparison =
    envelope?.questionnaire.comparison_version === COMPARISON_VERSION;
  const invalidComparison = supportsComparison && comparisonTooLong(comparison);
  const submitting = useRef(false);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const prefix = useId();
  // Only a persisted response counts as submitted, even while editing a draft.
  const status: InterviewCheckInStatus = envelope?.response
    ? "submitted"
    : envelope?.eligible
      ? "pending"
      : error
        ? "unavailable"
        : envelope
          ? "ineligible"
          : "loading";
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);
  useEffect(() => {
    // The submit button disappears after saving. Keep focus inside an open
    // popup for both a first submission and later edits, without reopening it.
    if (embedded && saved && confirmation.current?.closest("dialog")?.open)
      confirmation.current.focus();
  }, [embedded, saved]);
  const Container = embedded ? "div" : Panel;
  const containerClass = embedded ? "" : "no-print mt-6 p-4 sm:p-5";
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
      <Container className={containerClass}>
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
      </Container>
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
  const heading = (
    <span>
      <h2 className="text-base font-semibold" id={prefix + "-heading"}>
        {envelope.response
          ? "Your check-in is saved"
          : "How was your interview?"}
      </h2>
      <span className="mt-1 block text-xs text-[var(--color-muted)]">
        {envelope.response
          ? "Editing it is optional"
          : `${questions.length} quick questions · ${envelope.required ? "Required before your next interview" : "This check-in is optional."}`}
      </span>
    </span>
  );
  const content = (
    <>
      <p className="mt-4 text-sm text-[var(--color-muted)]">
        Your check-in does not block your report. Choose “Unable to judge” for
        anything you cannot rate.{" "}
        {IS_DESKTOP
          ? "Responses stay on this computer."
          : "Your responses are saved to your account for product improvement."}
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
            onClick={reportAvailable ? onReadReport : undefined}
          >
            Read your report{reportAvailable ? "" : " (new tab)"}
          </Link>
        ) : (
          "Your report is not available yet. You can say so in the report question and update it later."
        )}
      </p>
      {saved && (
        <p
          ref={confirmation}
          tabIndex={-1}
          className="notice mt-4"
          role="status"
        >
          {IS_DESKTOP
            ? "Check-in saved on this computer. Thank you."
            : "Check-in saved to your account. Thank you. Your usual interview allowance still applies."}
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
            Transcript inspection permission: {share ? "allowed" : "not given"}.
            Saved {new Date(envelope.response!.updated_at).toLocaleString()}.
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
          className="mt-5 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {questions.map((q, index) => (
            <fieldset
              key={q.id}
              disabled={busy}
              className="min-w-0 border-t border-[var(--color-line)] pt-3"
            >
              <legend className="max-w-full text-sm font-semibold">
                {index + 1}. {q.prompt}{" "}
                <span className="text-xs font-normal">(required)</span>
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <label
                    className="inline-flex min-h-10 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs leading-5 has-[:checked]:border-[var(--color-accent)] has-[:checked]:bg-[var(--color-panel-2)]"
                    key={o.value}
                  >
                    <input
                      className="mt-0.5"
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
                    <span className="min-w-0">{o.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          {supportsComparison && (
            <details className="rounded-lg border border-[var(--color-line)] p-3">
              <summary className="text-sm font-medium">
                Compare with other tools · optional
              </summary>
              <ToolComparisonFields
                value={comparison}
                disabled={busy}
                onChange={(value) => {
                  setComparison(value);
                  setDirty(true);
                  setSaved(false);
                }}
              />
            </details>
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
            Avoid personal, confidential or identifying information. No comment,
            diagnostics, research participation or transcript access is
            required.
          </p>
          {!IS_DESKTOP && (
            <label className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3 text-sm leading-5">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={share}
                disabled={busy}
                onChange={(e) => {
                  setShare(e.target.checked);
                  setDirty(true);
                }}
              />
              <span className="min-w-0">
                Allow maintainers to inspect this interview’s transcript to
                investigate my feedback (optional).{" "}
                <Link href="/privacy" className="underline">
                  Privacy details
                </Link>
              </span>
            </label>
          )}
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
    </>
  );
  return (
    <Container className={containerClass}>
      <section aria-labelledby={prefix + "-heading"} id="interview-check-in">
        {embedded ? (
          <>
            {heading}
            {content}
          </>
        ) : (
          <details
            open={expanded}
            onToggle={(event) => setExpanded(event.currentTarget.open)}
            className="check-in-details"
          >
            <summary className="check-in-summary">
              {heading}
              <span className="check-in-toggle" aria-hidden="true">
                ⌄
              </span>
            </summary>
            {content}
          </details>
        )}
      </section>
    </Container>
  );
}

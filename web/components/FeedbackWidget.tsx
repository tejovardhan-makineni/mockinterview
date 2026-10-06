"use client";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { IS_DESKTOP } from "@/lib/desktop";
import { sendProjectCopy } from "@/lib/analytics";
import { api, IS_MOCK } from "@/lib/api";
import { errorMessage } from "@/lib/http";
import type { FeedbackContext, FeedbackPayload } from "@/lib/features/feedback";
import { Button, Field, Input } from "@/components/ui";
import { IconFeedback } from "@/components/icons";

const MAX_MESSAGE = 5000;
const diagnosticKeys = [
  "connection",
  "mode",
  "ai_state",
  "status",
  "release",
  "format_version",
  "prompt_version",
  "section",
] as const;
export function FeedbackWidget({
  variant = "nav",
  getContext,
  label,
  target,
  sessionId,
}: {
  variant?: "nav" | "studio";
  getContext?: () => FeedbackContext;
  label?: string;
  target?: FeedbackPayload["kind"];
  sessionId?: string;
}) {
  const titleId = useId();
  const messageHintId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("");
  const [kind, setKind] = useState<FeedbackPayload["kind"]>(
    target ?? (variant === "studio" ? "interview" : "product"),
  );
  const [projectCopy, setProjectCopy] = useState(false);
  const [delivery, setDelivery] = useState("");
  const [diagnostics, setDiagnostics] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const messageLength = Array.from(message.trim()).length;
  const tooLong = messageLength > MAX_MESSAGE;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting.current || sent || tooLong || (!rating && !message.trim()))
      return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (IS_MOCK) {
        setSent(true);
        return;
      }
      const details = getContext?.() ?? {};
      const id = sessionId ?? String(details.session_id ?? "");
      const shareTranscript = transcript && !!id;
      const context: FeedbackContext = {};
      if (diagnostics) {
        for (const key of diagnosticKeys) {
          if (typeof details[key] === "string") context[key] = details[key];
        }
        Object.assign(context, {
          page: window.location.pathname,
          browser: navigator.userAgent,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          language: navigator.language,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          online: navigator.onLine ? "online" : "offline",
        });
      }
      if (shareTranscript && Array.isArray(details.transcript_tail)) {
        context.transcript_tail = details.transcript_tail;
      }
      const result = await api.sendFeedback({
        kind,
        message: message.trim() || undefined,
        rating: rating ? Number(rating) : undefined,
        session_id: id || undefined,
        tags: [
          variant === "studio" ? "source:interview-room" : "source:header",
        ],
        include_diagnostics: diagnostics,
        share_transcript: shareTranscript,
        context: diagnostics || shareTranscript ? context : undefined,
      });
      if (typeof result?.id !== "string" || !result.id.trim()) {
        throw new Error(
          "The service did not confirm your feedback was saved. Please try again.",
        );
      }
      setReference(result.id);
      if (IS_DESKTOP && projectCopy) {
        try {
          await sendProjectCopy("/api/v1/feedback", {
            kind,
            message: message.trim() || undefined,
            rating: rating ? Number(rating) : undefined,
            tags: ["source:desktop"],
            include_diagnostics: diagnostics,
            share_transcript: false,
            context: diagnostics
              ? Object.fromEntries(
                  Object.entries(context).filter(
                    ([key]) => key !== "transcript_tail",
                  ),
                )
              : undefined,
          });
          setDelivery(
            "Saved locally and delivered privately to the project admin.",
          );
        } catch {
          setDelivery(
            "Saved locally. The project copy was not delivered; connect sharing in Settings and try sending again when online.",
          );
        }
      } else if (IS_DESKTOP)
        setDelivery("Saved on this computer. No copy was sent to the project.");
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-label={
          label ??
          (variant === "studio" ? "Report a problem" : "Share feedback")
        }
        title={
          label ??
          (variant === "studio" ? "Report a problem" : "Share feedback")
        }
        className={
          variant === "nav"
            ? "mi-button mi-button-sm inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)]"
            : "inline-flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs font-medium"
        }
        onClick={() => {
          if (sent) {
            setMessage("");
            setRating("");
            setKind(target ?? (variant === "studio" ? "interview" : "product"));
            setSent(false);
            setReference("");
            setError("");
            setDiagnostics(false);
            setTranscript(false);
            setProjectCopy(false);
            setDelivery("");
          }
          dialog.current?.showModal();
        }}
      >
        <IconFeedback className="h-4 w-4 shrink-0" />
        <span
          className={variant === "nav" ? "sr-only sm:not-sr-only" : undefined}
        >
          {label ??
            (variant === "studio" ? "Report a problem" : "Share feedback")}
        </span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        className="m-auto max-h-[calc(100dvh-32px)] w-[min(480px,calc(100%-32px))] overflow-y-auto rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6 text-[var(--color-ink)] shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-semibold">
            {sent ? "Thank you." : "Help improve this experience"}
          </h2>
          <button
            type="button"
            aria-label="Close feedback"
            onClick={() => dialog.current?.close()}
          >
            ✕
          </button>
        </div>
        {sent ? (
          <>
            <p role="status" className="my-5 text-sm">
              {IS_MOCK
                ? "This is demo mode. No feedback was sent or stored."
                : IS_DESKTOP
                  ? delivery
                  : "Your feedback has been saved for the maintainers."}
            </p>
            {reference && (
              <p className="mb-5 break-all text-xs text-[var(--color-muted)]">
                Reference: {reference}
              </p>
            )}
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Done
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-5" aria-busy={busy}>
            <fieldset disabled={busy} className="min-w-0 space-y-4">
              <Field label="What is your feedback about?">
                <select
                  className="field-select"
                  value={kind}
                  onChange={(e) =>
                    setKind(e.target.value as FeedbackPayload["kind"])
                  }
                >
                  <option value="interviewer">Interviewer realism</option>
                  <option value="product">Product experience</option>
                  <option value="question">Question accuracy</option>
                  <option value="report">Feedback usefulness</option>
                  <option value="interview">
                    A problem during the interview
                  </option>
                </select>
              </Field>
              <Field label="Rating · optional">
                <select
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                  className="field-select"
                >
                  <option value="">Choose a rating</option>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                      {n === 1
                        ? " · Needs work"
                        : n === 5
                          ? " · Very good"
                          : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="text-xs text-[var(--color-muted)]">
                {IS_DESKTOP
                  ? "Feedback saves on this computer. Sending a project copy is optional and uses the hosted account connected in Settings."
                  : "Feedback is private to the operator and associated with your account email. Do not include sensitive personal information. Optional sharing controls below start off."}
              </p>
              <Field label="Anything you would like us to know? · optional">
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="field-select"
                  aria-describedby={messageHintId}
                  aria-invalid={tooLong || undefined}
                  placeholder="What happened, what did you expect, and how can we reproduce it? No passwords or API keys."
                />
              </Field>
              <p
                id={messageHintId}
                className={
                  "text-xs " +
                  (tooLong
                    ? "text-[var(--color-bad)]"
                    : "text-[var(--color-muted)]")
                }
              >
                {messageLength.toLocaleString()} /{" "}
                {MAX_MESSAGE.toLocaleString()} characters
                {tooLong &&
                  ". Shorten your message before sending; your draft has not been changed."}
              </p>
              <label className="flex items-start gap-2 text-xs">
                <Input
                  type="checkbox"
                  className="!min-h-4 !w-4 shrink-0"
                  checked={diagnostics}
                  onChange={(e) => setDiagnostics(e.target.checked)}
                />
                <span>
                  Include page and connection diagnostics
                  <span className="mt-1 block text-[var(--color-muted)]">
                    Shares this page’s path, browser, screen size, language,
                    time zone, and connection state.
                  </span>
                </span>
              </label>
              {!IS_DESKTOP && (sessionId || variant === "studio") && (
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="!min-h-4"
                    checked={transcript}
                    onChange={(e) => setTranscript(e.target.checked)}
                  />
                  Allow maintainers to inspect this interview’s transcript for
                  this report
                </label>
              )}
              {IS_DESKTOP && (
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={projectCopy}
                    onChange={(e) => setProjectCopy(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    Send this feedback to the project admin.{" "}
                    <Link href="/settings" className="underline">
                      Connect sharing
                    </Link>{" "}
                    first.
                  </span>
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-[var(--color-bad)]">
                  {error} Your unsent feedback is still here.
                </p>
              )}
              <Button
                type="submit"
                disabled={busy || tooLong || (!rating && !message.trim())}
              >
                {busy
                  ? IS_DESKTOP
                    ? "Saving…"
                    : "Sending…"
                  : IS_DESKTOP
                    ? "Save feedback"
                    : "Send feedback"}
              </Button>
            </fieldset>
          </form>
        )}
      </dialog>
    </>
  );
}

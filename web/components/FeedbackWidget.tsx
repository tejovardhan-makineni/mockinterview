"use client";
import { useId, useRef, useState } from "react";
import { api, IS_MOCK } from "@/lib/api";
import { errorMessage } from "@/lib/http";
import type { FeedbackContext, FeedbackPayload } from "@/lib/features/feedback";
import { Button, Field, Input } from "@/components/ui";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState("");
  const [kind, setKind] = useState<FeedbackPayload["kind"]>(
    target ?? (variant === "studio" ? "interview" : "product"),
  );
  const [diagnostics, setDiagnostics] = useState(false);
  const [transcript, setTranscript] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (IS_MOCK) {
        setSent(true);
        return;
      }
      const context = diagnostics
        ? {
            ...getContext?.(),
            page: window.location.pathname,
          }
        : undefined;
      const id = sessionId ?? String(getContext?.().session_id ?? "");
      await api.sendFeedback({
        kind,
        message: message.trim() || undefined,
        rating: rating ? Number(rating) : undefined,
        session_id: id || undefined,
        include_diagnostics: diagnostics,
        share_transcript: transcript,
        context,
      });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs font-medium"
        onClick={() => {
          setMessage("");
          setRating("");
          setSent(false);
          setError("");
          setDiagnostics(false);
          setTranscript(false);
          dialog.current?.showModal();
        }}
      >
        {label ??
          (variant === "studio" ? "Report a problem" : "Share feedback")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        className="m-auto w-[min(480px,calc(100%-32px))] rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6 text-[var(--color-ink)] shadow-xl backdrop:bg-black/40"
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
                : "Your feedback has been saved for the maintainers."}
            </p>
            <Button variant="ghost" onClick={() => dialog.current?.close()}>
              Done
            </Button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
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
                    {n === 1 ? " · Needs work" : n === 5 ? " · Very good" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <p className="text-xs text-[var(--color-muted)]">
              Feedback is private to the operator and associated with your
              account email. Do not include sensitive personal information.
              Optional sharing controls below start off.
            </p>
            <Field label="Anything you would like us to know? · optional">
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="field-select"
                placeholder="Describe what helped, or what could be better. No passwords or API keys."
              />
            </Field>
            <label className="flex items-start gap-2 text-xs">
              <Input
                type="checkbox"
                className="!min-h-4 !w-4 shrink-0"
                checked={diagnostics}
                onChange={(e) => setDiagnostics(e.target.checked)}
              />
              Include page and connection diagnostics
            </label>
            {(sessionId || variant === "studio") && (
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
            {error && (
              <p role="alert" className="text-sm text-[var(--color-bad)]">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || (!rating && !message.trim())}
            >
              {busy ? "Sending…" : "Send feedback"}
            </Button>
          </form>
        )}
      </dialog>
    </>
  );
}

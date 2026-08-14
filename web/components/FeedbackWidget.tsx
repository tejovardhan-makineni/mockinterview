"use client";

// FeedbackWidget — a trigger button + modal for sending feedback. Two variants:
//  - "nav": a sidebar row (general feedback; captures the current page).
//  - "studio": a compact button for the interview room; pass getContext() to
//    attach live interview debug details (session/section/connection/transcript)
//    so a reported problem can be reproduced.
// Pure React modal (no native dialog) so it never blocks the page.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FeedbackContext } from "@/lib/features/feedback";
import { useT } from "@/lib/i18n";
import { Button } from "@/components/ui";
import { IconFeedback } from "@/components/icons";

type Variant = "nav" | "studio";

export function FeedbackWidget({
  variant = "nav",
  getContext,
  label,
}: {
  variant?: Variant;
  getContext?: () => FeedbackContext;
  label?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState(0);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    textRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Reset the form and open (reset in the handler, not an effect).
  const openModal = () => { setMessage(""); setRating(0); setDone(false); setErr(""); setOpen(true); };

  const submit = async () => {
    const msg = message.trim();
    if (!msg || sending) return;
    setSending(true); setErr("");
    // Gather context lazily at submit time so it reflects the latest state.
    let ctx: FeedbackContext = {};
    try { ctx = { ...(getContext?.() ?? {}) }; } catch { /* best-effort */ }
    if (typeof window !== "undefined") {
      ctx.path = window.location.pathname + window.location.search;
      ctx.user_agent = navigator.userAgent;
      ctx.viewport = `${window.innerWidth}x${window.innerHeight}`;
      ctx.ts = new Date().toISOString();
    }
    try {
      await api.sendFeedback({ kind: variant === "studio" ? "interview" : "general", message: msg, rating, context: ctx });
      setDone(true);
      setTimeout(() => setOpen(false), 1100);
    } catch {
      setErr(t("Couldn't send — please try again."));
    } finally {
      setSending(false);
    }
  };

  const trigger =
    variant === "studio" ? (
      <button
        type="button"
        onClick={openModal}
        title={t("Report a problem with this interview")}
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-studio)] px-3 py-1.5 text-xs font-medium text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      >
        <IconFeedback className="h-3.5 w-3.5" />
        {label ?? t("Feedback")}
      </button>
    ) : (
      <button
        type="button"
        onClick={openModal}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--color-line)] px-4 py-2.5 text-sm font-medium text-[var(--color-muted)] transition hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
      >
        <IconFeedback className="h-4 w-4" />
        {label ?? t("Send feedback")}
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={t("Send feedback")}>
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6 shadow-2xl">
            {done ? (
              <div className="py-6 text-center">
                <div className="text-2xl">✓</div>
                <p className="mt-2 font-semibold">{t("Thanks — feedback sent!")}</p>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold tracking-tight">
                      {variant === "studio" ? t("Report a problem") : t("Send feedback")}
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {variant === "studio"
                        ? t("We attach this interview's details so we can debug what went wrong.")
                        : t("Bugs, ideas, anything — we read all of it.")}
                    </p>
                  </div>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("Close")} className="rounded-md px-2 py-1 text-[var(--color-faint)] hover:text-[var(--color-ink)]">✕</button>
                </div>

                {/* Optional rating */}
                <div className="mt-4 flex items-center gap-1" role="radiogroup" aria-label={t("Rating")}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n} type="button" role="radio" aria-checked={rating === n}
                      onClick={() => setRating(n === rating ? 0 : n)}
                      className={`text-xl leading-none transition ${n <= rating ? "text-[var(--color-accent)]" : "text-[var(--color-line)] hover:text-[var(--color-faint)]"}`}
                      aria-label={`${n}`}
                    >★</button>
                  ))}
                  <span className="ml-2 text-xs text-[var(--color-faint)]">{t("(optional)")}</span>
                </div>

                <textarea
                  ref={textRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  placeholder={variant === "studio" ? t("What happened? e.g. the interviewer talked over me, audio cut out, wrong question…") : t("What's on your mind?")}
                  className="mt-3 w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3.5 py-3 text-sm outline-none focus:border-[var(--color-accent)]"
                />

                {err && <p className="mt-2 text-xs text-[var(--color-bad)]">{err}</p>}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => setOpen(false)}>{t("Cancel")}</Button>
                  <Button variant="primary" onClick={submit} disabled={!message.trim() || sending}>
                    {sending ? t("Sending…") : t("Send")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RequiredFeedback } from "@/lib/features/feedback";
import { errorMessage } from "@/lib/http";
import { feedbackHref } from "@/lib/interviewFeedback";

export const feedbackChanged = () =>
  window.dispatchEvent(new Event("mi:interview-feedback-changed"));
export function useRequiredFeedback(enabled: boolean) {
  const [pending, setPending] = useState<RequiredFeedback | null>(null);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const active = useRef(false);
  const invalidate = useCallback(() => {
    generation.current++;
  }, []);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await api.getRequiredFeedback();
      if (active.current && request === generation.current) {
        setPending(result);
        setError("");
      }
      return result;
    } catch (e) {
      if (active.current && request === generation.current)
        setError(errorMessage(e));
      throw e;
    }
  }, []);
  useEffect(() => {
    active.current = enabled;
    if (!enabled) return;
    const load = () => {
      void refresh().catch(() => {});
    };
    load();
    window.addEventListener("mi:interview-feedback-changed", load);
    window.addEventListener("focus", load);
    return () => {
      active.current = false;
      invalidate();
      window.removeEventListener("mi:interview-feedback-changed", load);
      window.removeEventListener("focus", load);
    };
  }, [enabled, refresh, invalidate]);
  return {
    pending: enabled ? pending : null,
    error: enabled ? error : "",
    refresh,
  };
}
export function RequiredFeedbackNotice({
  pending,
  next,
  onNavigate,
}: {
  pending: RequiredFeedback | null;
  next?: string;
  onNavigate?: () => void;
}) {
  if (!pending?.total) return null;
  return (
    <section
      className="notice my-5 text-sm"
      aria-label="Interview check-in needed"
    >
      <p className="font-semibold">
        Before your next interview, complete a short required check-in.
      </p>
      <p className="mt-2">
        Your reports, history, exports and deletion controls remain available.
        Comments and transcript sharing are optional.
      </p>
      <ul className="mt-3 space-y-2">
        {pending.items.map((item) => (
          <li key={item.session_id}>
            <Link
              className="underline"
              href={feedbackHref(item.session_id, next)}
              onClick={onNavigate}
            >
              Review check-in: {item.question_title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

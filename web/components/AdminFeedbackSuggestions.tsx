"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { FeedbackSuggestions } from "@/lib/features/feedback";
import { errorMessage } from "@/lib/http";
import { ToolComparisonSummary } from "./ToolComparison";
import { Button, ErrorNotice, Panel } from "./ui";
export function AdminFeedbackSuggestions() {
  const [data, setData] = useState<FeedbackSuggestions | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  const sequence = useRef(0);
  const pending = useRef(false);
  const attemptedCursor = useRef<string | undefined>(undefined);
  const load = useCallback(async (before?: string) => {
    if (pending.current) return;
    pending.current = true;
    attemptedCursor.current = before;
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const result = await api.getFeedbackSuggestions(before);
      if (!active.current || request !== sequence.current) return;
      setData((previous) => ({
        next_cursor: result.next_cursor,
        items:
          before && previous
            ? [
                ...previous.items,
                ...result.items.filter(
                  (item) =>
                    !previous.items.some(
                      (p) => p.session_id === item.session_id,
                    ),
                ),
              ]
            : result.items,
      }));
    } catch (e) {
      if (active.current && request === sequence.current)
        setError(errorMessage(e));
    } finally {
      if (active.current && request === sequence.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }, []);
  const invalidate = useCallback(() => {
    sequence.current++;
    pending.current = false;
  }, []);
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    void Promise.resolve().then(() => {
      if (!cancelled) return load();
    });
    return () => {
      active.current = false;
      cancelled = true;
      invalidate();
    };
  }, [load, invalidate]);
  return (
    <section
      className="mt-10 border-t border-[var(--color-line)] pt-7"
      aria-labelledby="suggestions-heading"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="suggestions-heading" className="text-xl font-semibold">
          Suggestions
        </h2>
        <Button variant="ghost" disabled={busy} onClick={() => void load()}>
          Refresh suggestions
        </Button>
      </div>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Optional comments and tool comparisons, newest update first, across all
        dates and subjects. The aggregate filters above do not filter this list.
        Treat comments as private; do not publish them. Account identifiers and
        transcripts are not returned by this view, but comments may contain
        personal information.
      </p>
      {error && (
        <div className="mt-4">
          <ErrorNotice
            message={error}
            onRetry={() => void load(attemptedCursor.current)}
          />
        </div>
      )}
      {busy && (
        <p role="status" className="mt-4 text-sm">
          Loading suggestions…
        </p>
      )}
      {data && !data.items.length && !busy && (
        <p className="mt-4 text-sm">
          No optional comments or tool comparisons yet.
        </p>
      )}
      <div className="mt-5 space-y-4">
        {data?.items.map((item) => (
          <Panel key={item.session_id} className="p-5">
            <h3 className="text-sm font-semibold">{item.question_title}</h3>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              {item.subject_label} · {item.mode} · {item.provider} ·{" "}
              {item.status.replaceAll("_", " ")} · Updated{" "}
              {new Date(item.updated_at).toLocaleString()}
            </p>
            {item.comment && (
              <p className="mt-4 whitespace-pre-wrap break-words text-sm">
                {item.comment}
              </p>
            )}
            {item.comparison && (
              <ToolComparisonSummary value={item.comparison} />
            )}
          </Panel>
        ))}
      </div>
      {data?.next_cursor && (
        <Button
          variant="ghost"
          className="mt-5"
          disabled={busy}
          onClick={() => void load(data.next_cursor ?? undefined)}
        >
          Load more suggestions
        </Button>
      )}
    </section>
  );
}

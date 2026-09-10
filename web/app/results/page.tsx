"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { SessionHistoryItem } from "@/lib/features/interview";
import {
  RequiredFeedbackNotice,
  useRequiredFeedback,
  feedbackChanged,
} from "@/components/RequiredFeedbackNotice";
import { feedbackHref } from "@/lib/interviewFeedback";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Panel, ErrorNotice } from "@/components/ui";
export default function History() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const {
    pending,
    error: pendingError,
    refresh: refreshPending,
  } = useRequiredFeedback(signedIn);
  const [items, setItems] = useState<SessionHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [notice, setNotice] = useState("");
  const load = useCallback(
    async (before?: string) => {
      setError("");
      setLoading(true);
      try {
        const u = await api.me();
        if (!u) {
          router.replace("/login?next=/results");
          return;
        }
        setSignedIn(true);
        const records = await api.listSessions(before);
        setItems((prev) =>
          before
            ? [
                ...prev,
                ...records.filter((r) => !prev.some((p) => p.id === r.id)),
              ]
            : records,
        );
        setMore(records.length >= 50);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [router],
  );
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [load]);
  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteSession(id);
      setItems((prev) => prev.filter((s) => s.id !== id));
      setConfirm("");
      feedbackChanged();
      setNotice("Interview deleted. Your usage allowance is unchanged.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const shown = items.filter((i) =>
    (i.title + " " + i.modality + " " + i.status)
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <AppShell active="results">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Keep the useful parts</p>
          <h1 className="page-title mt-3">Your practice, in one place.</h1>
          <p className="mt-3 text-[var(--color-muted)]">
            Revisit your answers, saved work and next steps.
          </p>
        </div>
        <Button href="/interviews">Practice an interview →</Button>
      </div>
      {pending && <RequiredFeedbackNotice pending={pending} />}
      {pendingError && (
        <ErrorNotice
          message={"Check-in status could not load. " + pendingError}
          onRetry={() => void refreshPending().catch(() => {})}
        />
      )}
      <label className="mt-8 block">
        <span className="sr-only">Search loaded interview history</span>
        <input
          type="search"
          className="field-select max-w-lg"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your loaded interviews"
        />
      </label>
      {error && (
        <div className="mt-5">
          <ErrorNotice message={error} onRetry={() => void load()} />
        </div>
      )}
      {notice && (
        <p role="status" className="notice mt-5">
          {notice}
        </p>
      )}
      {loading && !items.length ? (
        <p className="mt-8" role="status">
          Loading history…
        </p>
      ) : !items.length && !error ? (
        <Panel className="mt-6 p-10 text-center">
          <h2 className="text-lg font-medium">
            Your first interview is a good place to start.
          </h2>
          <p className="my-4 text-sm text-[var(--color-muted)]">
            Choose a format and leave with a clearer next step.
          </p>
          <Button href="/interviews">Explore interviews</Button>
        </Panel>
      ) : (
        <div className="mt-6 space-y-3">
          {shown.map((item) => {
            const processing = [
              "scoring",
              "ending",
              "feedback_failed",
            ].includes(item.status);
            const recoverable = [
              "created",
              "reserved",
              "active",
              "interrupted",
            ].includes(item.status);
            const report = item.status === "complete" || processing;
            return (
              <Panel key={item.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="font-semibold">{item.title}</h2>
                    <p className="mt-2 text-xs text-[var(--color-muted)]">
                      {new Date(item.created_at).toLocaleString()} ·{" "}
                      {item.modality.replace(/_/g, " ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge
                      tone={
                        item.status === "feedback_failed" ? "warn" : "muted"
                      }
                    >
                      {item.status === "complete"
                        ? "Completed"
                        : item.status === "scoring"
                          ? "Preparing feedback"
                          : item.status === "feedback_failed"
                            ? "Feedback needs a retry"
                            : item.status.replace(/_/g, " ")}
                    </Badge>
                    {report ? (
                      <Button href={"/report?s=" + item.id} variant="ghost">
                        {processing ? "View progress" : "Review →"}
                      </Button>
                    ) : recoverable ? (
                      <Button href={"/interview?s=" + item.id} variant="ghost">
                        Resume →
                      </Button>
                    ) : null}
                    {pending?.items.some((p) => p.session_id === item.id) ? (
                      <Button href={feedbackHref(item.id)} variant="ghost">
                        Check-in needed →
                      </Button>
                    ) : [
                        "expired",
                        "abandoned",
                        "complete",
                        "feedback_failed",
                      ].includes(item.status) ? (
                      <Button href={feedbackHref(item.id)} variant="ghost">
                        Interview check-in
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={"Delete " + item.title}
                      className="text-xs text-[var(--color-muted)] underline"
                      onClick={() => setConfirm(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {confirm === item.id && (
                  <div className="notice mt-4">
                    <p className="text-sm">
                      Delete this interview and its saved content? This cannot
                      be undone and will not reset your allowance.
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        variant="danger"
                        disabled={busy}
                        onClick={() => void remove(item.id)}
                      >
                        Delete interview
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirm("")}>
                        Keep it
                      </Button>
                    </div>
                  </div>
                )}
              </Panel>
            );
          })}
          {!shown.length && (
            <p className="p-5 text-sm">
              No loaded interviews match this search.
            </p>
          )}
        </div>
      )}
      {more && (
        <Button
          className="mt-6"
          variant="ghost"
          disabled={loading}
          onClick={() => void load(items[items.length - 1]?.created_at)}
        >
          {loading ? "Loading…" : "Load older interviews"}
        </Button>
      )}
    </AppShell>
  );
}

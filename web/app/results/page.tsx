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
import { Button, Panel, ErrorNotice } from "@/components/ui";
import styles from "./results.module.css";

type InterviewTone = "violet" | "teal" | "amber" | "rose";

function modalityStyle(modality: string): {
  label: string;
  tone: InterviewTone;
} {
  switch (modality) {
    case "coding":
      return { label: "Coding", tone: "violet" };
    case "system_design":
      return { label: "System design", tone: "teal" };
    case "written":
      return { label: "Written exercise", tone: "amber" };
    case "conversational":
      return { label: "Conversation", tone: "rose" };
    default:
      return { label: modality.replace(/_/g, " "), tone: "violet" };
  }
}

function InterviewIcon({ modality }: { modality: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {modality === "coding" ? (
        <>
          <path d="m10 9-7 7 7 7M22 9l7 7-7 7M19 6l-6 20" />
        </>
      ) : modality === "system_design" ? (
        <>
          <rect x="11" y="3" width="10" height="8" rx="2" />
          <rect x="2" y="22" width="10" height="8" rx="2" />
          <rect x="20" y="22" width="10" height="8" rx="2" />
          <path d="M16 11v6M7 22v-5h18v5" />
        </>
      ) : modality === "written" ? (
        <>
          <path d="M22 7V4H5v24h22V14M10 11h5M10 23h12" />
          <path d="m17 16 9-9 3 3-9 9-4 1 1-4Z" />
        </>
      ) : (
        <>
          <path d="M27 19a4 4 0 0 1-4 4H13l-7 5v-7a4 4 0 0 1-3-4V8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v11Z" />
          <path d="M9 11h12M9 16h8" />
        </>
      )}
    </svg>
  );
}

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
      <div className={styles.history}>
        <section className={styles.hero} aria-labelledby="history-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Your practice journal</p>
            <h1 id="history-title" className={styles.title}>
              Small steps.
              <br />
              Stronger interviews.
            </h1>
            <p className={styles.heroDescription}>
              Revisit your answers, celebrate what clicked, and find your next
              thing to work on.
            </p>
            <Button href="/interviews" className={styles.primaryButton}>
              Practice an interview <span aria-hidden="true">↗</span>
            </Button>
          </div>
          <div className={styles.journalArt} aria-hidden="true">
            <span className={styles.artOrbit} />
            <span className={styles.artSpark}>✦</span>
            <div className={`${styles.artCard} ${styles.artCardBack}`}>
              <InterviewIcon modality="system_design" />
              <span />
              <span />
            </div>
            <div className={`${styles.artCard} ${styles.artCardFront}`}>
              <span className={styles.artCheck}>✓</span>
              <span className={styles.artLine} />
              <span />
              <span />
              <div className={styles.artDots}>
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className={styles.artCaption}>Reflect. Refine. Repeat.</div>
          </div>
        </section>
        {pending && <RequiredFeedbackNotice pending={pending} />}
        {pendingError && (
          <ErrorNotice
            message={"Check-in status could not load. " + pendingError}
            onRetry={() => void refreshPending().catch(() => {})}
          />
        )}
        <div className={styles.toolbar}>
          <div className={styles.sectionHeading}>
            <h2>Your interviews</h2>
            {items.length > 0 && (
              <span className={styles.loadedCount}>{items.length} loaded</span>
            )}
          </div>
          <label className={styles.search}>
            <span className="sr-only">Search loaded interview history</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              aria-hidden="true"
              focusable="false"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 5 5" />
            </svg>
            <input
              type="search"
              className="field-select"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your loaded interviews"
            />
          </label>
        </div>
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
          <p className={styles.loading} role="status">
            <span aria-hidden="true">✦</span> Loading history…
          </p>
        ) : !items.length && !error ? (
          <Panel className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <InterviewIcon modality="conversational" />
            </div>
            <h2>Your first interview is a good place to start.</h2>
            <p>Choose a format and leave with a clearer next step.</p>
            <Button href="/interviews" className={styles.primaryButton}>
              Explore interviews
            </Button>
          </Panel>
        ) : (
          <div className={styles.sessions}>
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
              const modality = modalityStyle(item.modality);
              return (
                <Panel key={item.id} className={styles.session}>
                  <div className={styles.sessionMain}>
                    <div
                      className={styles.modalityIcon}
                      data-tone={modality.tone}
                    >
                      <InterviewIcon modality={item.modality} />
                    </div>
                    <div className={styles.sessionCopy}>
                      <div className={styles.sessionLabels}>
                        <span
                          className={styles.modalityLabel}
                          data-tone={modality.tone}
                        >
                          {modality.label}
                        </span>
                        <span
                          className={styles.status}
                          data-state={item.status}
                        >
                          <span
                            aria-hidden="true"
                            className={styles.statusDot}
                          />
                          {item.status === "complete"
                            ? "Completed"
                            : item.status === "scoring"
                              ? "Preparing feedback"
                              : item.status === "feedback_failed"
                                ? "Feedback needs a retry"
                                : item.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      <h3>{item.title}</h3>
                      <p className={styles.sessionDate}>
                        <time dateTime={item.created_at}>
                          {new Date(item.created_at).toLocaleString()}
                        </time>
                      </p>
                    </div>
                    {report ? (
                      <Button
                        href={"/report?s=" + item.id}
                        variant="ghost"
                        className={styles.reviewButton}
                      >
                        {processing ? "View progress" : "Review →"}
                      </Button>
                    ) : recoverable ? (
                      <Button
                        href={"/interview?s=" + item.id}
                        variant="ghost"
                        className={styles.reviewButton}
                      >
                        Resume →
                      </Button>
                    ) : null}
                  </div>
                  <div className={styles.sessionFooter}>
                    {pending?.items.some((p) => p.session_id === item.id) ? (
                      <Button
                        href={feedbackHref(item.id)}
                        variant="ghost"
                        className={styles.checkInButton}
                      >
                        Check-in needed →
                      </Button>
                    ) : [
                        "expired",
                        "abandoned",
                        "complete",
                        "feedback_failed",
                      ].includes(item.status) ? (
                      <Button
                        href={feedbackHref(item.id)}
                        variant="ghost"
                        className={styles.checkInButton}
                      >
                        Interview check-in
                      </Button>
                    ) : null}
                    <button
                      type="button"
                      aria-label={"Delete " + item.title}
                      className={styles.deleteButton}
                      onClick={() => setConfirm(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                  {confirm === item.id && (
                    <div className="notice mt-4">
                      <p className="text-sm">
                        Delete this interview and its saved content? This cannot
                        be undone and will not reset your allowance.
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
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
              <Panel className={styles.noMatches}>
                <p>No loaded interviews match this search.</p>
                <p className="text-sm text-[var(--color-muted)]">
                  Try a title, format, or status.
                </p>
              </Panel>
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
      </div>
    </AppShell>
  );
}

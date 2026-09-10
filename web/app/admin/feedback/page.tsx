"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  FeedbackGroupBy,
  InterviewFeedbackMetrics,
} from "@/lib/features/feedback";
import { downloadAggregate, meanText, rateText } from "@/lib/interviewFeedback";
import { ComparisonMetrics } from "@/components/ComparisonMetrics";
import { downloadComparisonMetrics } from "@/lib/comparisonMetrics";
import { errorMessage } from "@/lib/http";
import { AdminFeedbackSuggestions } from "@/components/AdminFeedbackSuggestions";
import { AppShell } from "@/components/AppShell";
import { Button, ErrorNotice, Field, Panel } from "@/components/ui";
const groupings: FeedbackGroupBy[] = [
  "subject",
  "domain",
  "question",
  "mode",
  "provider",
  "format",
  "level",
];
const valueLabel = (value: string) =>
  ({
    unable_to_judge: "Unable to judge",
    report_not_read: "Report not read",
    report_unavailable: "Report unavailable",
  })[value] ?? value;
export default function FeedbackMetricsPage() {
  const [access, setAccess] = useState<"loading" | "admin" | "denied">(
    "loading",
  );
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState<FeedbackGroupBy>("subject");
  const [request, setRequest] = useState({
    days: 30,
    group: "subject" as FeedbackGroupBy,
    revision: 0,
  });
  const [data, setData] = useState<InterviewFeedbackMetrics | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((user) => {
        if (alive) setAccess(user?.role === "admin" ? "admin" : "denied");
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (access !== "admin") return;
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setBusy(true);
      setError("");
      return api
        .getInterviewFeedbackMetrics(request.days, request.group)
        .then((result) => {
          if (alive) setData(result);
        })
        .catch((e) => {
          if (alive) setError(errorMessage(e));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    });
    return () => {
      alive = false;
    };
  }, [access, request]);
  return (
    <AppShell active="settings">
      <p className="eyebrow">Administrator · Product improvement</p>
      <h1 className="page-title mt-3">Interview feedback</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Aggregate check-in responses. These are participants’ reports of their
        experience, not a measure of interviewing skill or a calibrated quality
        score.
      </p>
      {access === "denied" ? (
        <Panel className="mt-6 p-6">
          <h2 className="font-semibold">Administrator access required</h2>
          <p className="mt-3 text-sm">
            Sign in with an administrator account to view these aggregates. Your
            own reports and data controls remain available.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button href="/login?next=/admin/feedback" variant="ghost">
              Sign in
            </Button>
            <Button href="/results" variant="ghost">
              Your history
            </Button>
          </div>
        </Panel>
      ) : access === "loading" && !error ? (
        <p role="status" className="mt-5">
          Checking access…
        </p>
      ) : null}
      {error && (
        <div className="mt-5">
          <ErrorNotice
            message={error}
            onRetry={() =>
              access === "admin"
                ? setRequest((r) => ({ ...r, revision: r.revision + 1 }))
                : window.location.reload()
            }
          />
        </div>
      )}
      {access === "admin" && (
        <>
          <form
            className="mt-7 flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setRequest({ days, group, revision: request.revision + 1 });
            }}
          >
            <Field label="Interview start window">
              <select
                className="field-select"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                {[7, 30, 90, 365].map((n) => (
                  <option value={n} key={n}>
                    Past {n} days
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Group responses by">
              <select
                className="field-select"
                value={group}
                onChange={(e) => setGroup(e.target.value as FeedbackGroupBy)}
              >
                {groupings.map((g) => (
                  <option key={g} value={g}>
                    {g[0].toUpperCase() + g.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Loading…" : "Apply filters"}
            </Button>
          </form>
          {data && (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                <p className="text-xs text-[var(--color-muted)]">
                  Showing {data.days} days grouped by {data.group_by}. Generated{" "}
                  {new Date(data.generated_at).toLocaleString()}.
                  {busy ? " Updating; the previous result is shown below." : ""}
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="ghost"
                    onClick={() => downloadAggregate(data, "json")}
                  >
                    Download JSON
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => downloadAggregate(data, "csv")}
                  >
                    Download ratings CSV
                  </Button>
                  {(data.comparison ||
                    data.groups.some((g) => g.comparison)) && (
                    <Button
                      variant="ghost"
                      onClick={() => downloadComparisonMetrics(data)}
                    >
                      Download comparison CSV
                    </Button>
                  )}
                </div>
              </div>
              <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Eligible interviews", data.totals.eligible_sessions],
                  ["Responded", data.totals.responded_sessions],
                  ["Pending", data.totals.pending_sessions],
                  [
                    "Response rate",
                    data.totals.response_rate === null
                      ? "No attempts"
                      : rateText(data.totals.response_rate),
                  ],
                ].map(([label, value]) => (
                  <Panel key={label} className="p-5">
                    <dt className="text-xs text-[var(--color-muted)]">
                      {label}
                    </dt>
                    <dd className="mt-2 text-2xl font-semibold">{value}</dd>
                  </Panel>
                ))}
              </dl>
              {data.comparison && (
                <div className="mt-5">
                  <ComparisonMetrics
                    data={data.comparison}
                    title="Optional tool comparison · all submitted check-ins"
                  />
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    This optional section is separate from the six required
                    ratings. It describes participants’ comparisons, not a
                    verified benchmark of other tools.
                  </p>
                </div>
              )}
              <p className="notice my-5 text-sm">
                {data.note} “Unable to judge,” “Report not read,” and “Report
                unavailable” are excluded from numeric averages and
                favorable-rate denominators. A higher number is not always
                better: challenge fit is favorable at 3 (about right);
                disruption is favorable at 1 (no interruption); the other four
                items at 4 or 5.
              </p>
              {!data.groups.length ? (
                <p className="mt-5">No eligible interviews in this window.</p>
              ) : (
                <div className="space-y-5">
                  {data.groups.map((g) => (
                    <Panel key={g.key} className="min-w-0 p-5">
                      <h2 className="break-words text-lg font-semibold">
                        {g.label}
                      </h2>
                      <p className="mt-2 text-xs text-[var(--color-muted)]">
                        {g.responded_sessions} responded / {g.eligible_sessions}{" "}
                        eligible · {g.pending_sessions} pending ·{" "}
                        {g.response_rate === null
                          ? "No attempts"
                          : rateText(g.response_rate)}{" "}
                        response rate
                      </p>
                      {g.comparison && (
                        <div className="mt-4">
                          <ComparisonMetrics data={g.comparison} />
                        </div>
                      )}
                      <div className="mt-4 space-y-4">
                        {g.questions.map((q) => (
                          <section
                            key={q.id}
                            className="rounded-lg border border-[var(--color-line)] p-4"
                          >
                            <h3 className="text-sm font-semibold">{q.label}</h3>
                            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-3 text-xs">
                              <div>
                                <dt>Numeric ratings</dt>
                                <dd className="mt-1 font-medium">
                                  {q.answered_count}
                                </dd>
                              </div>
                              <div>
                                <dt>Unrated responses</dt>
                                <dd className="mt-1 font-medium">
                                  {q.unrated_count}
                                </dd>
                              </div>
                              <div>
                                <dt>Mean (1–5)</dt>
                                <dd className="mt-1 font-medium">
                                  {[
                                    "challenge_fit",
                                    "disruption_severity",
                                  ].includes(q.id)
                                    ? "Not calculated for this item"
                                    : meanText(q.mean)}
                                </dd>
                              </div>
                              <div>
                                <dt>Favorable: {q.favorable_label}</dt>
                                <dd className="mt-1 font-medium">
                                  {q.favorable_count} ·{" "}
                                  {rateText(q.favorable_rate)}
                                </dd>
                              </div>
                            </dl>
                            <p className="mt-3 text-xs font-medium">
                              Answer distribution (count)
                            </p>
                            <ul className="mt-2 flex flex-wrap gap-2 text-xs">
                              {Object.entries(q.distribution).map(([v, n]) => (
                                <li
                                  key={v}
                                  className="rounded bg-[var(--color-panel-2)] px-3 py-2"
                                >
                                  {valueLabel(v)}: {n}
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                    </Panel>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
      {access === "admin" && <AdminFeedbackSuggestions />}
    </AppShell>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, ErrorNotice, Panel } from "@/components/ui";
import {
  communityApi,
  type CommunityOverview,
  type TemplateRequest,
} from "@/lib/features/community";
import { ApiError, errorMessage } from "@/lib/http";
const when = (value: string) => new Date(value).toLocaleString();

export default function AdminPage() {
  const [data, setData] = useState<CommunityOverview | null>(null);
  const [error, setError] = useState("");
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState("");
  const load = useCallback(async (isCurrent: () => boolean = () => true) => {
    try {
      const result = await communityApi.overview();
      if (!isCurrent()) return;
      setError("");
      setData(result);
      setDenied(false);
    } catch (e) {
      if (!isCurrent()) return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setDenied(true);
        setData(null);
      } else setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) return load(() => alive);
    });
    return () => {
      alive = false;
    };
  }, [load]);
  async function review(id: string, action: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  const uploads = data?.uploads ?? [];
  return (
    <AppShell active="settings">
      <p className="eyebrow">Private maintainer workspace</p>
      <h1 className="page-title mt-3">Admin portal</h1>
      <p className="mt-3 text-sm text-[var(--color-muted)]">
        Review beta access, requested templates, product feedback, and
        voluntarily shared interview results. Recent lists show up to 200
        records.
      </p>
      {denied ? (
        <Panel className="mt-7 p-6">
          <h2 className="text-xl font-semibold">Owner access required</h2>
          <p className="mt-3 text-sm">
            Sign in with the verified, provisioned maintainer account.
          </p>
          <Button href="/login?next=/admin" className="mt-5">
            Sign in
          </Button>
        </Panel>
      ) : !data && !error ? (
        <p role="status" className="mt-7">
          Checking access…
        </p>
      ) : null}
      {error && (
        <div className="my-6">
          <ErrorNotice message={error} onRetry={() => void load()} />
        </div>
      )}
      {data && (
        <>
          <div className="my-6 flex flex-wrap gap-3">
            <Button href="/admin/feedback">Interview feedback metrics</Button>
            <Button variant="ghost" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Pending beta applications",
                data.applications.filter((a) => a.status === "pending").length,
              ],
              [
                "Open template requests",
                data.requests.filter((r) => r.status === "new").length,
              ],
              [
                "Shared completed interviews",
                uploads.filter((r) => r.payload.status === "complete").length,
              ],
              [
                "Shared interrupted / failed",
                uploads.filter((r) => r.payload.status !== "complete").length,
              ],
            ].map(([title, value]) => (
              <Panel key={title} className="p-5">
                <dt className="text-xs text-[var(--color-muted)]">{title}</dt>
                <dd className="mt-2 text-3xl font-semibold">{value}</dd>
              </Panel>
            ))}
          </dl>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Shared result counts cover the recent opt-in uploads shown below,
            not all users or a quality benchmark.
          </p>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold">Beta applications</h2>
            <div className="mt-4 space-y-3">
              {!data.applications.length && (
                <p className="text-sm text-[var(--color-muted)]">
                  No applications yet.
                </p>
              )}
              {data.applications.map((a) => (
                <Panel key={a.id} className="p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <h3 className="break-all font-semibold">{a.email}</h3>
                    <Badge>{a.status}</Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm">
                    {a.motivation}
                  </p>
                  <p className="mt-3 text-xs text-[var(--color-muted)]">
                    Feedback commitment accepted · {when(a.created_at)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      disabled={!!busy || a.status === "approved"}
                      onClick={() =>
                        void review(a.id, () =>
                          communityApi.reviewBeta(a.id, "approved"),
                        )
                      }
                    >
                      {busy === a.id ? "Saving…" : "Approve unlimited access"}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!!busy || a.status === "rejected"}
                      onClick={() =>
                        void review(a.id, () =>
                          communityApi.reviewBeta(a.id, "rejected"),
                        )
                      }
                    >
                      {a.status === "approved" ? "Revoke access" : "Decline"}
                    </Button>
                  </div>
                </Panel>
              ))}
            </div>
          </section>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold">Template requests</h2>
            <div className="mt-4 space-y-3">
              {!data.requests.length && (
                <p className="text-sm text-[var(--color-muted)]">
                  No requests yet.
                </p>
              )}
              {data.requests.map((r) => (
                <Panel key={r.id} className="p-5">
                  <h3 className="font-semibold">
                    {r.profession} · {r.level}
                  </h3>
                  <p className="mt-2 text-sm">{r.goal}</p>
                  <p className="mt-3 whitespace-pre-wrap text-sm">
                    {r.description}
                  </p>
                  <p className="mt-3 break-all text-xs text-[var(--color-muted)]">
                    {r.email} · {when(r.created_at)}
                  </p>
                  <label className="mt-4 block text-sm">
                    Review status
                    <select
                      className="field-select mt-2 max-w-xs"
                      value={r.status}
                      disabled={!!busy}
                      onChange={(e) =>
                        void review(r.id, () =>
                          communityApi.reviewTemplate(
                            r.id,
                            e.target.value as TemplateRequest["status"],
                          ),
                        )
                      }
                    >
                      {["new", "planned", "shipped", "closed"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </Panel>
              ))}
            </div>
          </section>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold">Product feedback</h2>
            <div className="mt-4 space-y-3">
              {!data.feedback?.length && (
                <p className="text-sm text-[var(--color-muted)]">
                  No product feedback yet.
                </p>
              )}
              {data.feedback?.map((f) => (
                <Panel key={f.id} className="p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <h3 className="font-semibold">
                      {f.kind}
                      {f.rating ? ` · ${f.rating}/5` : ""}
                    </h3>
                    <Badge>{f.status}</Badge>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm">
                    {f.message || "Rating only"}
                  </p>
                  <p className="mt-3 break-all text-xs text-[var(--color-muted)]">
                    {f.email} · {when(f.created_at)}
                  </p>
                  {f.context && (
                    <details className="mt-4 text-sm">
                      <summary>Shared context</summary>
                      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(f.context, null, 2)}
                      </pre>
                    </details>
                  )}
                  <label className="mt-4 block text-sm">
                    Review status
                    <select
                      className="field-select mt-2 max-w-xs"
                      value={f.status}
                      disabled={!!busy}
                      onChange={(e) =>
                        void review(f.id, () =>
                          communityApi.reviewFeedback(f.id, e.target.value),
                        )
                      }
                    >
                      {["new", "reviewed", "planned", "resolved"].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </Panel>
              ))}
            </div>
          </section>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold">Shared interview results</h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Participants opted in to share these results for product
              improvement. No transcript or recording is included.
            </p>
            <div className="mt-4 space-y-3">
              {!uploads.length && (
                <p className="text-sm text-[var(--color-muted)]">
                  No shared results yet.
                </p>
              )}
              {uploads.map((u) => (
                <Panel key={u.id} className="p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <h3 className="font-semibold">
                      {u.source} · {u.payload.provider || "Unknown provider"} ·{" "}
                      {u.payload.model || "Unknown model"}
                    </h3>
                    <Badge>{u.payload.status}</Badge>
                  </div>
                  <p className="mt-3 text-sm">
                    {u.payload.duration_seconds}s · {u.payload.turn_count} turns
                    · {u.payload.error_count} errors
                    {u.payload.score !== undefined
                      ? ` · Score ${u.payload.score}`
                      : ""}
                  </p>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    {when(u.created_at)} · Consent {u.consent_version}
                  </p>
                  {u.payload.feedback && (
                    <p className="mt-3 whitespace-pre-wrap text-sm">
                      {u.payload.feedback}
                    </p>
                  )}
                  {u.payload.report && (
                    <details className="mt-4 text-sm">
                      <summary>Shared report</summary>
                      <p className="mt-3">
                        {u.payload.report.scored
                          ? `Overall: ${u.payload.report.overall}`
                          : "Unscored"}
                      </p>
                      <p className="mt-3 whitespace-pre-wrap">
                        {u.payload.report.coaching_md}
                      </p>
                      {u.payload.report.scores?.map((s, i) => (
                        <p key={i} className="mt-3">
                          <strong>
                            {s.dimension}: {s.score}
                          </strong>
                          {s.rationale && ` — ${s.rationale}`}
                        </p>
                      ))}
                    </details>
                  )}
                </Panel>
              ))}
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

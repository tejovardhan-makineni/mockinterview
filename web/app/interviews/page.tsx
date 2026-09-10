"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { matchScore, type QuestionSummary } from "@/lib/features/catalog";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, ErrorNotice, Panel } from "@/components/ui";
const pretty = (s: string) =>
  s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const modality: Record<string, string> = {
  system_design: "Whiteboard",
  coding: "Code review",
  written: "Written",
  conversational: "Conversation",
};
export default function Catalog() {
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [format, setFormat] = useState("");
  const [level, setLevel] = useState("");
  const [visible, setVisible] = useState(24);
  const load = () => {
    setLoading(true);
    setError("");
    api
      .listQuestions()
      .then(setQuestions)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    api
      .listQuestions()
      .then(setQuestions)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  const roles = useMemo(
    () => [...new Set(questions.flatMap((q) => q.areas ?? []))].sort(),
    [questions],
  );
  const formats = useMemo(
    () =>
      [
        ...new Set(
          questions
            .filter((q) => !role || q.areas.includes(role))
            .map((q) => q.domain),
        ),
      ].sort(),
    [questions, role],
  );
  const filtered = useMemo(
    () =>
      questions
        .filter(
          (q) =>
            (!role || q.areas.includes(role)) &&
            (!format || q.domain === format) &&
            (!level || q.difficulty === level),
        )
        .map((q) => ({ q, score: matchScore(q, query) }))
        .filter((x) => x.score > 0.34)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.q),
    [questions, query, role, format, level],
  );
  return (
    <AppShell active="interview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your next interview</p>
          <h1 className="page-title mt-3">What would you like to practice?</h1>
          <p className="mt-3 text-[var(--color-muted)]">
            Find a conversation that fits your role. Set your level and pace
            before you begin.
          </p>
        </div>
        <Button href="/packs" variant="ghost">
          Explore practice paths
        </Button>
      </div>
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <label className="sr-only" htmlFor="catalog-search">
          Search interviews
        </label>
        <input
          id="catalog-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field-select"
          placeholder="Search a topic, skill, or scenario"
        />
        <select
          aria-label="Profession"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setFormat("");
          }}
          className="field-select"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {pretty(r)}
            </option>
          ))}
        </select>
        <select
          aria-label="Interview format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
          className="field-select"
        >
          <option value="">All formats</option>
          {formats.map((f) => (
            <option key={f} value={f}>
              {pretty(f)}
            </option>
          ))}
        </select>
        <select
          aria-label="Target level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="field-select"
        >
          <option value="">All levels</option>
          {["entry", "junior", "mid", "senior", "staff"].map((l) => (
            <option key={l} value={l}>
              {pretty(l)}
            </option>
          ))}
        </select>
      </div>
      <p className="my-5 text-xs text-[var(--color-muted)]" role="status">
        {loading
          ? "Loading interviews…"
          : filtered.length + " scenarios · open to explore before signing in"}
      </p>
      {error ? (
        <ErrorNotice message={error} onRetry={load} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, visible).map((q) => (
            <Panel key={q.id} className="flex flex-col p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{modality[q.modality]}</Badge>
                <span className="text-xs text-[var(--color-muted)]">
                  {q.minutes ?? (q.modality === "conversational" ? 20 : 30)} min
                </span>
              </div>
              <h2 className="mt-5 text-lg font-semibold leading-snug">
                {q.title}
              </h2>
              <p className="mt-3 flex-1 text-sm text-[var(--color-muted)]">
                {q.blurb}
              </p>
              <div className="mt-5 flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--color-muted)]">
                  {pretty(q.difficulty)} ·{" "}
                  {q.review_status === "reviewed"
                    ? "Reviewed"
                    : "Community preview"}
                </span>
                <Button
                  href={"/setup?q=" + encodeURIComponent(q.id)}
                  variant="ghost"
                >
                  Choose →
                </Button>
              </div>
            </Panel>
          ))}
        </div>
      )}
      {!loading && !error && filtered.length > visible && (
        <div className="mt-6 text-center">
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Showing {visible} of {filtered.length} scenarios. Search and filters
            cover the full collection.
          </p>
          <Button variant="ghost" onClick={() => setVisible((n) => n + 24)}>
            Show more interviews
          </Button>
        </div>
      )}
      {!loading && !error && !filtered.length && (
        <Panel className="p-10 text-center">
          <h2 className="font-semibold">A different search may help.</h2>
          <p className="my-3 text-sm text-[var(--color-muted)]">
            Explore all roles, or help the community add the format you need.
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              setQuery("");
              setRole("");
              setFormat("");
              setLevel("");
            }}
          >
            Clear filters
          </Button>
        </Panel>
      )}
    </AppShell>
  );
}

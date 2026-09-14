"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, IS_MOCK } from "@/lib/api";
import {
  filterCatalog,
  type CatalogFilters,
  type QuestionSummary,
} from "@/lib/features/catalog";
import type { Profession } from "@/lib/features/profile";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, ErrorNotice, Field, Panel } from "@/components/ui";
const pretty = (s: string) =>
  s.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const modality: Record<string, string> = {
  system_design: "Whiteboard",
  coding: "Code review",
  written: "Written",
  conversational: "Conversation",
};
export default function Catalog() {
  const [questions, setQuestions] = useState<QuestionSummary[]>([]);
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<CatalogFilters>({});
  const [visible, setVisible] = useState(24);
  const [attempt, setAttempt] = useState(0);
  const load = () => setAttempt((n) => n + 1);
  useEffect(() => {
    let alive = true;
    Promise.all([api.listQuestions(), api.listProfessions()])
      .then(([bank, registry]) => {
        if (!alive) return;
        setQuestions(bank);
        setProfessions(registry);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = () => {
    setLoading(true);
    setError("");
    load();
  };
  const updateFilters = useCallback((next: Partial<CatalogFilters>) => {
    setFilters((previous) => ({ ...previous, ...next }));
    setVisible(24);
  }, []);
  const reset = () => {
    setFilters({});
    setVisible(24);
  };
  const families = useMemo(
    () =>
      Array.from(
        new Map(
          professions
            .filter((p) => p.family)
            .map((p) => [p.family!, p.family_label ?? pretty(p.family!)]),
        ),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [professions],
  );
  const roles = useMemo(
    () =>
      professions
        .filter((p) => !filters.family || p.family === filters.family)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [professions, filters.family],
  );
  const roleQuestions = useMemo(
    () =>
      filterCatalog(questions, professions, {
        family: filters.family,
        profession: filters.profession,
      }),
    [questions, professions, filters.family, filters.profession],
  );
  const formats = useMemo(
    () =>
      Array.from(
        new Map(
          roleQuestions
            .filter((q) => q.format_id)
            .map((q) => [q.format_id!, q.format_name ?? pretty(q.format_id!)]),
        ),
      ).sort((a, b) => a[1].localeCompare(b[1])),
    [roleQuestions],
  );
  const topics = useMemo(
    () => [...new Set(roleQuestions.map((q) => q.domain))].sort(),
    [roleQuestions],
  );
  const filtered = useMemo(
    () => filterCatalog(questions, professions, filters),
    [questions, professions, filters],
  );
  const selectedProfession = professions.find(
    (p) => p.key === filters.profession,
  );
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <AppShell active="interview">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your next interview</p>
          <h1 className="page-title mt-3">What would you like to practice?</h1>
          <p className="mt-3 max-w-3xl text-[var(--color-muted)]">
            Explore career families, find your profession, and practice with a
            specialist AI interviewer. Prepare for your first job, a career
            change, or your next step. Hosted practice is for adults 18 and
            older.
          </p>
        </div>
        <Button href="/packs" variant="ghost">
          Explore practice paths
        </Button>
      </div>
      <Panel className="mt-8 p-5 sm:p-6">
        <Field label="Search interviews">
          <input
            id="catalog-search"
            type="search"
            value={filters.query ?? ""}
            onChange={(e) => updateFilters({ query: e.target.value })}
            className="field-select"
            placeholder="Try teacher, customer service, career change, or a skill"
          />
        </Field>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Field label="Career family">
            <select
              aria-label="Career family"
              value={filters.family ?? ""}
              onChange={(e) =>
                updateFilters({
                  family: e.target.value,
                  profession: "",
                  topic: "",
                  format: "",
                })
              }
              className="field-select"
            >
              <option value="">All career families</option>
              {families.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Profession">
            <select
              aria-label="Profession"
              value={filters.profession ?? ""}
              onChange={(e) =>
                updateFilters({
                  profession: e.target.value,
                  topic: "",
                  format: "",
                })
              }
              className="field-select"
            >
              <option value="">All professions</option>
              {roles.map((role) => (
                <option key={role.key} value={role.key}>
                  {role.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Interview format">
            <select
              aria-label="Interview format"
              value={filters.format ?? ""}
              onChange={(e) => updateFilters({ format: e.target.value })}
              className="field-select"
            >
              <option value="">All interview formats</option>
              {formats.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <details className="mt-5 border-t border-[var(--color-line)] pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            Refine by skill, level, and workspace
            {[filters.topic, filters.level, filters.workspace].filter(Boolean)
              .length > 0 &&
              ` · ${[filters.topic, filters.level, filters.workspace].filter(Boolean).length} active`}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Skill / topic">
              <select
                aria-label="Skill / topic"
                value={filters.topic ?? ""}
                onChange={(e) => updateFilters({ topic: e.target.value })}
                className="field-select"
              >
                <option value="">All skills and topics</option>
                {topics.map((topic) => (
                  <option key={topic} value={topic}>
                    {pretty(topic)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Scenario level"
              hint="You can adjust your target level before starting."
            >
              <select
                aria-label="Scenario level"
                value={filters.level ?? ""}
                onChange={(e) => updateFilters({ level: e.target.value })}
                className="field-select"
              >
                <option value="">All levels</option>
                {["entry", "junior", "mid", "senior", "staff"].map((level) => (
                  <option key={level} value={level}>
                    {pretty(level)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Workspace">
              <select
                aria-label="Workspace"
                value={filters.workspace ?? ""}
                onChange={(e) => updateFilters({ workspace: e.target.value })}
                className="field-select"
              >
                <option value="">All workspaces</option>
                {Object.entries(modality).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </details>
      </Panel>
      {selectedProfession?.agent && (
        <Panel className="mt-5 p-5">
          <p className="eyebrow">Specialist AI interviewer</p>
          <h2 className="mt-2 font-semibold">
            {selectedProfession.agent.name}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            {selectedProfession.agent.summary}
          </p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            Each scenario shows the specialist assigned to that practice.
          </p>
        </Panel>
      )}
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--color-muted)]" role="status">
          {loading
            ? "Loading interviews…"
            : error
              ? "The interview bank could not load."
              : `${filtered.length} ${filtered.length === 1 ? "scenario" : "scenarios"} · open to explore before signing in`}
          {IS_MOCK &&
            !loading &&
            !error &&
            " · Demo preview: a small sample of the full bank"}
        </p>
        {hasFilters && (
          <Button variant="ghost" onClick={reset}>
            Clear filters
          </Button>
        )}
      </div>
      {error ? (
        <ErrorNotice message={error} onRetry={retry} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.slice(0, visible).map((q) => (
            <Panel key={q.id} className="flex flex-col p-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>
                  {q.format_name ??
                    (q.format_id ? pretty(q.format_id) : "Interview practice")}
                </Badge>
                <span className="text-xs text-[var(--color-muted)]">
                  {q.minutes ?? (q.modality === "conversational" ? 20 : 30)} min
                </span>
              </div>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                {pretty(q.domain)} ·{" "}
                {modality[q.modality] ?? pretty(q.modality)}
              </p>
              <h2 className="mt-3 text-lg font-semibold leading-snug">
                {q.title}
              </h2>
              <p className="mt-3 flex-1 text-sm text-[var(--color-muted)]">
                {q.blurb}
              </p>
              {q.agent && (
                <p className="mt-4 text-xs text-[var(--color-muted)]">
                  AI interviewer · {q.agent.name}
                </p>
              )}
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
            Explore all professions, or help the community add the practice you
            need.
          </p>
          {!hasFilters && (
            <Button href="/contribute" variant="ghost">
              Suggest an interview
            </Button>
          )}
        </Panel>
      )}
    </AppShell>
  );
}

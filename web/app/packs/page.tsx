"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Pack, PackDetail } from "@/lib/features/packs";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Panel, ErrorNotice } from "@/components/ui";
export default function Paths() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [detail, setDetail] = useState<PackDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .listPacks()
      .then(setPacks)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);
  return (
    <AppShell active="interview">
      <a href="/interviews" className="text-sm">
        ← All interviews
      </a>
      <p className="eyebrow mt-7">Practice with a direction</p>
      <h1 className="page-title mt-3">A path through your preparation.</h1>
      <p className="mt-3 text-[var(--color-muted)]">
        Curated rounds inspired by interview patterns. Each round is a separate
        attempt under your allowance.
      </p>
      <p className="mt-2 text-xs text-[var(--color-muted)]">
        Community previews. These paths are not affiliated with employers or
        guarantees of their current process.
      </p>
      {error && (
        <div className="mt-5">
          <ErrorNotice message={error} />
        </div>
      )}
      {loading ? (
        <p className="mt-7" role="status">
          Loading paths…
        </p>
      ) : detail ? (
        <Panel className="mt-7 p-6">
          <Button variant="ghost" onClick={() => setDetail(null)}>
            ← All paths
          </Button>
          <h2 className="mt-5 text-2xl font-medium">{detail.name}</h2>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            {detail.blurb}
          </p>
          <div className="mt-6 space-y-4">
            {detail.rounds.map((round, i) => (
              <div
                key={round.id}
                className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] py-4"
              >
                <div>
                  <h3 className="font-semibold">
                    {i + 1}. {round.title}
                  </h3>
                  <p className="mt-2 text-xs text-[var(--color-muted)]">
                    {round.minutes} minutes · {round.difficulty} · One attempt
                  </p>
                </div>
                <Button
                  href={
                    "/setup?pack=" +
                    encodeURIComponent(detail.id) +
                    "&round=" +
                    encodeURIComponent(round.id)
                  }
                  variant="ghost"
                >
                  Prepare this round →
                </Button>
              </div>
            ))}
          </div>
        </Panel>
      ) : (
        <div className="mt-7 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {packs.map((pack) => (
            <Panel key={pack.id} className="flex flex-col p-6">
              <Badge>{pack.rounds.length} rounds</Badge>
              <h2 className="mt-4 text-xl font-medium">{pack.name}</h2>
              <p className="my-4 flex-1 text-sm text-[var(--color-muted)]">
                {pack.blurb}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  setError("");
                  void api
                    .getPack(pack.id)
                    .then(setDetail)
                    .catch((e) => setError(errorMessage(e)));
                }}
              >
                Explore path →
              </Button>
            </Panel>
          ))}
        </div>
      )}
    </AppShell>
  );
}

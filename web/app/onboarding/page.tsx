"use client";

// First-login gate: the user must pick at least one profession before using the
// app. What they pick is stored on the profile as `professions` and gates the
// interview catalog. Editable later in Settings. The AppShell redirect gate
// sends un-onboarded users here; this page is defensive on its own too
// (redirects to /login when signed out, to /dashboard when already onboarded).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
import type { Profession } from "@/lib/features/profile";
import { Button, Panel } from "@/components/ui";
import { useT } from "@/lib/i18n";

export default function OnboardingPage() {
  const t = useT();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>({});
  const [professions, setProfessions] = useState<Profession[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const u = await api.me();
      if (!u) { router.replace("/login"); return; }
      const [p, list] = await Promise.all([api.getProfile(), api.listProfessions()]);
      // Already onboarded → straight to the app.
      if ((p?.professions?.length ?? 0) > 0) { router.replace("/dashboard"); return; }
      setProfile(p || {});
      setProfessions(list);
      setLoading(false);
    })();
  }, [router]);

  const toggle = (key: string) =>
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));

  async function cont() {
    if (selected.length === 0 || saving) return;
    setSaving(true);
    try {
      await api.saveProfile({ ...profile, professions: selected });
      router.replace("/dashboard");
    } catch {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6 py-12">
      <div className="mb-8 flex items-center gap-2.5 text-lg font-bold">
        <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-live)]" />
        mockinterview<span className="text-[var(--color-accent)]">.live</span>
      </div>
      <Panel className="p-7 md:p-9">
        <h1 className="text-3xl font-extrabold tracking-tight">{t("What do you interview for?")}</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          {t("Pick one or more. We’ll tailor your interview catalog to what you selected — you can change this anytime in Settings.")}
        </p>

        {loading ? (
          <p className="mt-8 text-[var(--color-muted)]">{t("Loading…")}</p>
        ) : (
          <>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {professions.map((p) => {
                const on = selected.includes(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(p.key)}
                    className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${
                      on
                        ? "border-[var(--color-accent)] bg-[var(--color-panel-2)]"
                        : "border-[var(--color-line)] hover:bg-[var(--color-panel-2)]"
                    }`}
                  >
                    <span className="font-medium text-[var(--color-ink)]">{p.label}</span>
                    <span
                      aria-hidden
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${
                        on ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white" : "border-[var(--color-line)] text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-8 flex items-center gap-4">
              <Button onClick={cont} disabled={selected.length === 0 || saving}>
                {saving ? t("Saving…") : t("Continue →")}
              </Button>
              <span className="text-sm text-[var(--color-faint)]">
                {selected.length === 0 ? t("Select at least one to continue.") : `${selected.length} ${t("selected")}`}
              </span>
            </div>
          </>
        )}
      </Panel>
    </main>
  );
}

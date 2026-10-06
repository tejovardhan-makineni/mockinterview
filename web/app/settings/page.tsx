"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IS_DESKTOP, saveDesktopPreferences } from "@/lib/desktop";
import { DesktopModelSettings } from "@/components/DesktopModelSettings";
import { api } from "@/lib/api";
import { account, type User } from "@/lib/features/auth";
import {
  apiBase,
  authHeader,
  clearPrivateBrowserData,
  errorMessage,
} from "@/lib/http";
import { AnalyticsSettings } from "@/components/AnalyticsSettings";
import { AppShell } from "@/components/AppShell";
import { AppVersion } from "@/components/AppVersion";
import { Button, Field, Input, Panel, ErrorNotice } from "@/components/ui";
export default function Settings() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [appearance, setAppearance] = useState("light");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const u = await api.me();
        if (!u) {
          router.replace("/login?next=/settings");
          return;
        }
        setUser(u);
        setAppearance(
          document.documentElement.dataset.theme === "dark" ? "dark" : "light",
        );
        const p = await api.getProfile();
        setName(p?.name ?? "");
        setTarget(p?.target_role ?? "");
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, [router]);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportAccount() {
    const response = await fetch(apiBase() + "/api/v1/account/export", {
      headers: authHeader(),
    });
    if (!response.ok)
      throw new Error("Your export could not be prepared. Please retry.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mockinterview-account.json";
    link.click();
    URL.revokeObjectURL(url);
    setNotice("Your account export is ready.");
  }
  return (
    <AppShell active="settings">
      <p className="eyebrow">Make yourself at home</p>
      <h1 className="page-title mt-3">
        {IS_DESKTOP ? "App & preferences" : "Account & preferences"}
      </h1>
      <p className="mt-3 text-xs text-[var(--color-muted)]">
        <AppVersion showBuild />
      </p>
      {error && (
        <div className="mt-6">
          <ErrorNotice message={error} />
        </div>
      )}
      {notice && (
        <p className="notice mt-6" role="status">
          {notice}
        </p>
      )}
      <div className="mt-7 grid items-start gap-5 lg:grid-cols-2">
        {IS_DESKTOP && (
          <Panel className="p-4 sm:p-6">
            <DesktopModelSettings />
          </Panel>
        )}
        <Panel className="p-4 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">
            Help improve the project
          </h2>
          <AnalyticsSettings userId={user?.id} />
        </Panel>
        <Panel className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold">
            {IS_DESKTOP ? "Your local profile" : "Your account"}
          </h2>
          <p className="mt-3 break-words text-sm">
            {IS_DESKTOP
              ? "Saved on this computer. No online account is needed for practice."
              : (user?.email ?? "Loading account…")}
          </p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            {!IS_DESKTOP && user?.email_verified === false
              ? "Email verification needed for hosted practice."
              : user
                ? "Account ready."
                : ""}
          </p>
          {!IS_DESKTOP && user?.email_verified === false && (
            <Button
              className="mt-4"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const r = await account.resend();
                  setNotice(
                    r.message ?? "Check your inbox for a verification link.",
                  );
                })
              }
            >
              Resend verification
            </Button>
          )}
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void action(async () => {
                const profile = await api.getProfile();
                await api.saveProfile({
                  ...profile,
                  name,
                  target_role: target,
                });
                setNotice("Preferences saved.");
              });
            }}
          >
            <Field label="Name · optional">
              <Input
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Target role · optional">
              <Input
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="The role you are preparing for"
              />
            </Field>
            <Button type="submit" variant="ghost" disabled={busy}>
              Save preferences
            </Button>
          </form>
        </Panel>
        {!IS_DESKTOP && (
          <Panel className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Change your password</h2>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              Other signed-in sessions will be invalidated.
            </p>
            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await account.change(oldPassword, password);
                  setOldPassword("");
                  setPassword("");
                  setNotice("Your password was changed.");
                });
              }}
            >
              <Field label="Current password">
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                />
              </Field>
              <Field label="New password · at least 12 characters">
                <Input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
              <Button type="submit" variant="ghost" disabled={busy}>
                Change password
              </Button>
            </form>
          </Panel>
        )}
        <Panel className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold">Your data</h2>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Export your records, or delete individual interviews from History.
            Camera analysis is disabled in this release. Camera self-view stays
            local and optional.
          </p>
          <Button
            className="mt-5"
            variant="ghost"
            disabled={busy}
            onClick={() => void action(exportAccount)}
          >
            Export account data
          </Button>
          <h3 className="mt-7 text-sm font-semibold">Appearance</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {["light", "dark"].map((theme) => (
              <Button
                key={theme}
                size="sm"
                aria-pressed={appearance === theme}
                variant={appearance === theme ? "primary" : "ghost"}
                onClick={() => {
                  setAppearance(theme);
                  document.documentElement.dataset.theme = theme;
                  localStorage.setItem("mi_theme", theme);
                  if (IS_DESKTOP)
                    void saveDesktopPreferences({
                      theme: theme as "light" | "dark",
                    }).catch((e) => setError(errorMessage(e)));
                }}
              >
                {theme === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </div>
        </Panel>
        {IS_DESKTOP ? (
          <Panel className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Local storage</h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Your interviews, reports and settings are saved in this app’s
              local database. Use History to delete individual interviews or
              export your records above. Optional shared copies have a separate
              delete control.
            </p>
          </Panel>
        ) : (
          <Panel className="p-4 sm:p-6">
            <h2 className="text-lg font-semibold">Delete your account</h2>
            <p className="mt-3 text-sm text-[var(--color-muted)]">
              Permanently delete your account, resumes, interview content and
              feedback. This cannot be undone. Export anything you want to keep
              first. A minimal keyed email hash and claim time are retained to
              enforce the one-time free allowance. Deleting an account does not
              reset that allowance. Detailed start records expire after seven
              days.
            </p>
            {confirm ? (
              <div className="mt-5 space-y-3">
                <p role="alert" className="text-sm font-semibold">
                  Delete your account and interview content?
                </p>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        await api.deleteAccount();
                        clearPrivateBrowserData();
                        router.replace("/");
                      })
                    }
                  >
                    Yes, delete my account
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Keep my account
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="danger"
                className="mt-5"
                onClick={() => setConfirm(true)}
              >
                Delete account…
              </Button>
            )}
          </Panel>
        )}
      </div>
    </AppShell>
  );
}

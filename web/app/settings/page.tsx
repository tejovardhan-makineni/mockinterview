"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { account, type User } from "@/lib/features/auth";
import {
  BASE,
  authHeader,
  clearPrivateBrowserData,
  errorMessage,
} from "@/lib/http";
import { AppShell } from "@/components/AppShell";
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
    const response = await fetch(BASE + "/api/v1/account/export", {
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
      <h1 className="page-title mt-3">Account & preferences</h1>
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
      <div className="mt-7 grid gap-5 lg:grid-cols-2">
        <Panel className="p-6">
          <h2 className="text-lg font-semibold">Your account</h2>
          <p className="mt-3 text-sm">{user?.email ?? "Loading account…"}</p>
          <p className="mt-2 text-xs text-[var(--color-muted)]">
            {user?.email_verified === false
              ? "Email verification needed for hosted practice."
              : user
                ? "Account ready."
                : ""}
          </p>
          {user?.email_verified === false && (
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
        <Panel className="p-6">
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
        <Panel className="p-6">
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
          <div className="mt-3 flex gap-3">
            {["light", "dark"].map((theme) => (
              <Button
                key={theme}
                variant="ghost"
                onClick={() => {
                  document.documentElement.dataset.theme = theme;
                  localStorage.setItem("mi_theme", theme);
                }}
              >
                {theme === "light" ? "Light" : "Dark"}
              </Button>
            ))}
          </div>
        </Panel>
        <Panel className="p-6">
          <h2 className="text-lg font-semibold">Delete your account</h2>
          <p className="mt-3 text-sm text-[var(--color-muted)]">
            Permanently delete your account, resumes, interview content and
            feedback. This cannot be undone. Export anything you want to keep
            first. A minimal record of interview starts is retained for the
            seven-day allowance window; deleting an account does not reset it.
          </p>
          {confirm ? (
            <div className="mt-5 space-y-3">
              <p role="alert" className="text-sm font-semibold">
                Delete your account and interview content?
              </p>
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
      </div>
    </AppShell>
  );
}

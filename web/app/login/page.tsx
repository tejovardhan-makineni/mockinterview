"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, IS_MOCK } from "@/lib/api";
import { account } from "@/lib/features/auth";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Button, Field, Input, Panel, ErrorNotice } from "@/components/ui";
function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const next = params.get("next") ?? "/interviews";
  const destination =
    next.startsWith("/") && !next.startsWith("//") ? next : "/interviews";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "forgot") {
        const r = await account.forgot(email);
        setNotice(
          r.message ??
            "If this address has an account, a recovery link will be sent.",
        );
        setLink(r.development_action_url ?? "");
      } else if (mode === "register") {
        const r = await api.register(email, password);
        if (r.verification_required) {
          setNotice(
            "Your account is ready. Verify your email before starting a hosted interview. Check your inbox for a verification link.",
          );
          setLink(r.development_action_url ?? "");
        } else router.push(destination);
      } else {
        await api.login(email, password);
        router.push(destination);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell active="public">
      <Panel className="mx-auto my-8 max-w-md p-8">
        <p className="eyebrow">Your next step</p>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">
          {mode === "register"
            ? "Make room to practice."
            : mode === "forgot"
              ? "Recover your account."
              : "Welcome back."}
        </h1>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          {mode === "register"
            ? "Save your interviews and turn feedback into progress."
            : mode === "forgot"
              ? "We’ll send a secure link if this email has an account."
              : "Your practice and feedback are waiting."}
        </p>
        <form className="mt-7 space-y-5" onSubmit={submit}>
          <Field label="Email">
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {mode !== "forgot" && (
            <Field
              label="Password"
              hint={
                mode === "register"
                  ? "Use at least 12 characters. Password managers and pasted passwords are welcome."
                  : undefined
              }
            >
              <Input
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                required
                minLength={mode === "register" && !IS_MOCK ? 12 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {error && <ErrorNotice message={error} />}
          <Button type="submit" disabled={busy} className="w-full">
            {busy
              ? "Please wait…"
              : mode === "forgot"
                ? "Send recovery link"
                : mode === "register"
                  ? "Create account"
                  : "Sign in"}
          </Button>
        </form>
        {notice && (
          <div className="notice mt-5" role="status">
            {notice}
            {link && (
              <a href={link} className="mt-3 block underline">
                Open local development action link
              </a>
            )}
            <Button href={destination} variant="ghost" className="mt-4">
              Continue to practice
            </Button>
          </div>
        )}
        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
          <button
            className="underline"
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError("");
              setNotice("");
            }}
          >
            {mode === "login" ? "Create an account" : "Back to sign in"}
          </button>
          {mode === "login" && (
            <button className="underline" onClick={() => setMode("forgot")}>
              Forgot password?
            </button>
          )}
        </div>
        <p className="mt-6 text-xs text-[var(--color-muted)]">
          By using this service, review{" "}
          <a href="/terms" className="underline">
            Using mockinterview
          </a>{" "}
          and{" "}
          <a href="/privacy" className="underline">
            Privacy & your data
          </a>
          .
        </p>
      </Panel>
    </AppShell>
  );
}
export default function LoginPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading sign in…</p>}>
      <Login />
    </Suspense>
  );
}

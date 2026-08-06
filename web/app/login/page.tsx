"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, IS_MOCK } from "@/lib/api";
import { Button, Field, Input, Panel } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (mode === "register") await api.register(email, password);
      else await api.login(email, password);
      router.push("/dashboard");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <div className="mb-8 flex items-center gap-2.5 text-lg font-bold">
        <span className="live-dot inline-block h-2.5 w-2.5 rounded-full bg-[var(--color-live)]" />
        mockinterview<span className="text-[var(--color-accent)]">.live</span>
      </div>
      <Panel className="p-7">
        <h1 className="text-2xl font-bold">{mode === "register" ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1.5 text-sm text-[var(--color-muted)]">
          {mode === "register" ? "Start your first mock interview in under a minute." : "Sign in to continue."}
        </p>
        {IS_MOCK && (
          <p className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] px-3 py-2 text-xs text-[var(--color-faint)]">
            Demo mode — any email/password works, no backend needed.
          </p>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          </Field>
          {err && <p className="text-sm text-[var(--color-bad)]">{err}</p>}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "…" : mode === "register" ? "Create account" : "Sign in"}
          </Button>
        </form>
        <button
          className="mt-5 w-full text-center text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          onClick={() => setMode(mode === "register" ? "login" : "register")}
        >
          {mode === "register" ? "Already have an account? Sign in" : "Need an account? Register"}
        </button>
      </Panel>
    </main>
  );
}

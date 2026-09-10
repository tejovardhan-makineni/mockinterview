"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { account } from "@/lib/features/auth";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { Button, Field, Input, Panel, ErrorNotice } from "@/components/ui";
function Action() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [completedAction, setCompletedAction] = useState<
    "reset" | "verify" | null
  >(null);
  const reset = completedAction
    ? completedAction === "reset"
    : params.get("action") === "reset";
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const done = completedAction !== null;
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (reset) await account.reset(token, password);
      else await account.verify(token);
      setCompletedAction(reset ? "reset" : "verify");
      window.history.replaceState({}, "", window.location.pathname);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppShell active="public">
      <Panel className="mx-auto my-8 max-w-md p-8">
        <h1 className="text-2xl font-medium">
          {reset ? "Choose a new password" : "Verify your email"}
        </h1>
        {done ? (
          <div role="status">
            <p className="my-5">
              {reset
                ? "Your password has been changed. Sign in with your new password."
                : "Your email has been verified. You can continue to practice."}
            </p>
            <Button href={reset ? "/login" : "/interviews"}>Continue</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-5">
            {reset && (
              <Field label="New password">
                <Input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>
            )}
            {error && <ErrorNotice message={error} />}
            <Button type="submit" disabled={busy || !token}>
              {busy
                ? "Please wait…"
                : reset
                  ? "Save new password"
                  : "Verify email"}
            </Button>
            {!token && (
              <p role="alert">
                This link is missing its token. Request a new link from sign in
                or Settings.
              </p>
            )}
          </form>
        )}
      </Panel>
    </AppShell>
  );
}
export default function AuthAction() {
  return (
    <Suspense fallback={<p className="p-10">Loading account action…</p>}>
      <Action />
    </Suspense>
  );
}

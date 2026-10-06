"use client";
import { useEffect, useState } from "react";
import { IS_DESKTOP } from "@/lib/desktop";
import { AppShell } from "@/components/AppShell";
import { Button, ErrorNotice, Field, Panel } from "@/components/ui";
import { communityApi, type BetaApplication } from "@/lib/features/community";
import { ApiError, errorMessage } from "@/lib/http";

export default function BetaPage() {
  const [application, setApplication] = useState<BetaApplication | null>(null);
  const [access, setAccess] = useState<"loading" | "signed_in" | "signed_out">(
    "loading",
  );
  const [unlimited, setUnlimited] = useState(false);
  const [motivation, setMotivation] = useState("");
  const [commitment, setCommitment] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (IS_DESKTOP) return;
    let alive = true;
    communityApi
      .betaStatus()
      .then((data) => {
        if (alive) {
          setAccess("signed_in");
          setApplication(data.application);
          setUnlimited(data.unlimited);
        }
      })
      .catch((e) => {
        if (alive) {
          if (e instanceof ApiError && e.status === 401)
            setAccess("signed_out");
          else setError(errorMessage(e));
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  if (IS_DESKTOP)
    return (
      <AppShell active="public">
        <p className="eyebrow">Project testing</p>
        <h1 className="page-title mt-3">Help improve desktop practice</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          Desktop interviews always use your own API key. Share feedback in the
          app, or visit the project to contribute improvements.
        </p>
        <Button href="/contribute" className="mt-6">
          Ways to contribute
        </Button>
      </AppShell>
    );
  const pending = application?.status === "pending";
  return (
    <AppShell active="public">
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Build this with us</p>
        <h1 className="page-title mt-3">Join the beta</h1>
        <p className="mt-4 text-[var(--color-muted)]">
          Help make interview practice work for more people. Approved beta
          testers can practice beyond the one-time free allowance in exchange
          for regular, honest feedback. All funded interviews share the
          project’s capacity of 200 per UTC day.
        </p>
        <Panel className="mt-8 p-6 sm:p-8">
          {error && (
            <div className="mb-5">
              <ErrorNotice message={error} />
            </div>
          )}
          {unlimited ? (
            <>
              <h2 className="text-xl font-semibold">You’re a beta tester</h2>
              <p className="mt-3 text-sm">
                Your tester access is active, within the shared daily capacity.
                After each interview, tell us what helped and what needs work.
              </p>
              <Button href="/interviews" className="mt-5">
                Start practicing
              </Button>
            </>
          ) : pending ? (
            <>
              <h2 className="text-xl font-semibold">
                Your application is under review
              </h2>
              <p className="mt-3 text-sm">
                Your commitment is saved. Check this page for approval; until
                then, you can use your one free interview or your own API key.
              </p>
              <Button href="/interviews" variant="ghost" className="mt-5">
                Keep practicing
              </Button>
            </>
          ) : access === "signed_out" ? (
            <>
              <h2 className="text-xl font-semibold">Start with an account</h2>
              <p className="mt-3 text-sm">
                Sign in and verify your email to apply. Applications are
                reviewed privately by the project maintainer.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button href="/login?next=/beta">
                  Sign in or create account
                </Button>
              </div>
            </>
          ) : access === "loading" ? (
            <p role="status">Checking your application…</p>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  setApplication(
                    await communityApi.applyBeta(motivation, commitment),
                  );
                } catch (e) {
                  setError(errorMessage(e));
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-5"
            >
              <h2 className="text-xl font-semibold">
                Tell us what you’ll test
              </h2>
              {application?.status === "rejected" && (
                <p className="notice text-sm">
                  Your earlier application was not approved. You can update your
                  plan and apply again.
                </p>
              )}
              <Field
                label="Your testing plan"
                hint="Your profession, the interviews you want to practice, and how you can help."
              >
                <textarea
                  className="field-select min-h-36"
                  value={motivation}
                  onChange={(e) => setMotivation(e.target.value)}
                  required
                  minLength={10}
                  maxLength={2000}
                />
              </Field>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={commitment}
                  onChange={(e) => setCommitment(e.target.checked)}
                  required
                />
                <span>
                  I agree to provide regular feedback about interviews, issues,
                  and improvements during the beta.
                </span>
              </label>
              <p className="text-xs text-[var(--color-muted)]">
                Beta access requires approval and may be withdrawn. Sharing
                optional analytics is a separate choice in Settings.
              </p>
              <Button type="submit" disabled={busy || !commitment}>
                {busy ? "Submitting…" : "Apply for beta access"}
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}

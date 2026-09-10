"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { LegalPolicy } from "@/lib/features/auth";
import { localDestination, policyDestination } from "@/lib/policyNavigation";
import { errorMessage } from "@/lib/http";
import { AppShell } from "@/components/AppShell";
import { PolicyFields } from "@/components/PolicyFields";
import { Button, ErrorNotice, Panel } from "@/components/ui";

function Consent() {
  const router = useRouter();
  const params = useSearchParams();
  const next = localDestination(params.get("next"));
  const [policy, setPolicy] = useState<LegalPolicy | null>(null);
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.me(), api.legalPolicy()])
      .then(([user, current]) => {
        if (cancelled) return;
        if (!user)
          router.replace(
            "/login?next=" + encodeURIComponent(policyDestination(next)),
          );
        else if (!user.policies_required) router.replace(next);
        else setPolicy(current);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [next, router]);
  return (
    <AppShell active="public">
      <Panel className="mx-auto my-8 max-w-xl p-8">
        <p className="eyebrow">A moment before practice</p>
        <h1 className="mt-3 text-3xl font-medium">
          Review your use of mockinterview
        </h1>
        <p className="my-5 text-sm text-[var(--color-muted)]">
          Hosted AI practice is for adults. Please review the current terms and
          data notice before uploading material or continuing an interview. Your
          saved history and account controls remain available.
        </p>
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!policy || !adult || !accepted) return;
            setBusy(true);
            setError("");
            try {
              await api.acceptPolicies({
                adult_confirmed: adult,
                terms_version: policy.terms_version,
                privacy_version: policy.privacy_version,
              });
              router.replace(next);
            } catch (e) {
              setError(errorMessage(e));
              setBusy(false);
            }
          }}
        >
          <PolicyFields
            adult={adult}
            accepted={accepted}
            onAdult={setAdult}
            onAccepted={setAccepted}
          />
          {policy && (
            <p className="text-xs text-[var(--color-muted)]">
              Terms: {policy.terms_version} · Privacy notice:{" "}
              {policy.privacy_version}
            </p>
          )}
          {error && (
            <ErrorNotice
              message={error}
              onRetry={() => window.location.reload()}
            />
          )}
          <Button
            type="submit"
            disabled={!policy || !adult || !accepted || busy}
          >
            {busy ? "Saving…" : "Agree & continue"}
          </Button>
        </form>
        <div className="mt-6 flex flex-wrap gap-5 text-sm">
          <a href="/results" className="underline">
            View history
          </a>
          <a href="/settings" className="underline">
            Export or delete account
          </a>
          <a href="/help" className="underline">
            Contact support
          </a>
        </div>
      </Panel>
    </AppShell>
  );
}
export default function ConsentPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading terms review…</p>}>
      <Consent />
    </Suspense>
  );
}

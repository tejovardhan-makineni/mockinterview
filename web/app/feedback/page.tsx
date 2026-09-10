"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { InterviewCheckIn } from "@/components/InterviewCheckIn";
import { Button, ErrorNotice } from "@/components/ui";
import { errorMessage } from "@/lib/http";
import { localDestination } from "@/lib/policyNavigation";
function FeedbackPageContent() {
  const params = useSearchParams();
  const router = useRouter();
  const sid = params.get("s") ?? "";
  const next = localDestination(params.get("next"), "/results");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((user) => {
        if (!alive) return;
        if (!user)
          router.replace(
            "/login?next=" +
              encodeURIComponent(
                "/feedback?s=" + sid + "&next=" + encodeURIComponent(next),
              ),
          );
        else setReady(true);
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [sid, next, router]);
  return (
    <AppShell active="results">
      <p className="eyebrow">Your experience matters</p>
      <h1 className="page-title mt-3">After your interview</h1>
      <p className="mt-3 text-sm">
        Tell us what needs attention. Your saved interviews stay accessible.
      </p>
      {error && (
        <ErrorNotice message={error} onRetry={() => window.location.reload()} />
      )}
      {!sid ? (
        <p className="notice mt-5">
          Choose an interview from History to review its check-in.
        </p>
      ) : ready ? (
        <InterviewCheckIn key={sid} sessionId={sid} showIneligible />
      ) : (
        !error && (
          <p className="mt-5" role="status">
            Loading your account…
          </p>
        )
      )}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button href={next} variant="ghost">
          {next.startsWith("/setup")
            ? "Return to interview setup"
            : "Back to history"}
        </Button>
        <Button href="/settings" variant="ghost">
          Account & data controls
        </Button>
      </div>
    </AppShell>
  );
}
export default function FeedbackPage() {
  return (
    <Suspense fallback={<p className="p-10">Loading check-in…</p>}>
      <FeedbackPageContent />
    </Suspense>
  );
}

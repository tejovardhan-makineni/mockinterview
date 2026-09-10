"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, IS_MOCK } from "@/lib/api";
import { Button } from "./ui";
import { FeedbackWidget } from "./FeedbackWidget";
export type NavKey =
  | "dashboard"
  | "interview"
  | "packs"
  | "resume"
  | "results"
  | "settings"
  | "contribute"
  | "public";
export const SOURCE_URL =
  "https://github.com/tejovardhan-makineni/mockinterview";
export function Footer({ feedback = false }: { feedback?: boolean }) {
  return (
    <footer className="no-print mx-auto flex max-w-[1160px] flex-wrap items-center justify-between gap-4 border-t border-[var(--color-line)] px-6 py-6 text-xs text-[var(--color-muted)]">
      <span>Open source. Room to improve, together.</span>
      {feedback && <FeedbackWidget target="product" />}
      <nav aria-label="Information" className="flex flex-wrap gap-5">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/help">Help</Link>
        <a href={SOURCE_URL}>Source</a>
        <a href="/third-party-notices.txt">Licenses</a>
      </nav>
    </footer>
  );
}
export function AppShell({
  active,
  children,
}: {
  active: NavKey;
  children: ReactNode;
}) {
  const [admin, setAdmin] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [policiesRequired, setPoliciesRequired] = useState(false);
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((u) => {
        if (alive) {
          setSignedIn(!!u);
          setAdmin(u?.role === "admin");
          setPoliciesRequired(!!u?.policies_required);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const current =
    active === "results"
      ? "History"
      : active === "contribute"
        ? "Contribute"
        : ["public", "settings"].includes(active)
          ? ""
          : "Practice";
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="no-print border-b border-[var(--color-line)] bg-[var(--color-panel)]">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-8 gap-y-3 px-6 py-4">
          <Link
            href="/"
            className="mr-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight no-underline"
          >
            <span
              className="grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent)] text-[var(--color-panel)]"
              aria-hidden="true"
            >
              m
            </span>
            mockinterview
            <span className="hidden text-xs font-normal text-[var(--color-muted)] sm:inline">
              .live
            </span>
          </Link>
          <nav aria-label="Main" className="flex gap-1">
            {[
              { label: "Practice", href: "/interviews" },
              { label: "History", href: "/results" },
              { label: "Contribute", href: "/contribute" },
            ].map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={current === n.label ? "page" : undefined}
                className={
                  "rounded-lg px-3 py-2.5 text-sm no-underline " +
                  (current === n.label
                    ? "bg-[var(--color-panel-2)] font-semibold"
                    : "text-[var(--color-muted)]")
                }
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {signedIn ? (
            <details className="relative">
              <summary className="px-2 py-2 text-sm">Account</summary>
              <div className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-2 shadow-lg">
                <Link href="/settings" className="block rounded-lg p-3 text-sm">
                  Settings
                </Link>
                <Link
                  href="/resume-review"
                  className="block rounded-lg p-3 text-sm"
                >
                  Resume review
                </Link>
                {admin && (
                  <Link
                    href="/admin/feedback"
                    className="block rounded-lg p-3 text-sm"
                  >
                    Interview feedback metrics
                  </Link>
                )}
                <button
                  className="w-full rounded-lg p-3 text-left text-sm"
                  onClick={() => {
                    void Promise.resolve(api.logout())
                      .catch(() => {})
                      .finally(() => {
                        setSignedIn(false);
                        router.replace("/");
                      });
                  }}
                >
                  Sign out
                </button>
              </div>
            </details>
          ) : (
            <Button href="/login" variant="ghost">
              Sign in
            </Button>
          )}
        </div>
      </header>
      {IS_MOCK && (
        <div
          className="notice mx-auto max-w-[1160px] rounded-none text-center"
          role="status"
        >
          Demo environment · simulated interviews and reports; feedback is not
          sent.
        </div>
      )}
      <main id="main-content" className="page-width" tabIndex={-1}>
        {signedIn && policiesRequired && active !== "public" && (
          <p className="notice mb-6 text-sm">
            Before your next AI practice,{" "}
            <Link href="/consent" className="underline">
              review the updated terms and privacy notice and confirm you are 18
              or older
            </Link>
            . Your history and account controls remain available.
          </p>
        )}
        {children}
      </main>
      <Footer feedback={signedIn} />
    </>
  );
}

"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IS_DESKTOP } from "@/lib/desktop";
import { api, IS_MOCK } from "@/lib/api";
import { Button } from "./ui";
import { syncAnalytics, disconnectAnalytics } from "@/lib/analytics";
import { FeedbackWidget } from "./FeedbackWidget";
import { CommunityIconLink, CommunityIcons } from "./project/CommunityIcons";
import { ProfileMenu } from "./ProfileMenu";
import { AppVersion } from "./AppVersion";
export { SOURCE_URL } from "@/lib/project";
export type NavKey =
  | "dashboard"
  | "interview"
  | "packs"
  | "resume"
  | "results"
  | "settings"
  | "contribute"
  | "public";
export function Footer() {
  return (
    <footer className="no-print mx-auto flex max-w-[1160px] flex-wrap items-center justify-end gap-4 border-t border-[var(--color-line)] px-6 py-6 text-xs text-[var(--color-muted)]">
      <div className="mr-auto flex flex-wrap items-center gap-4">
        <AppVersion />
        {IS_DESKTOP && <CommunityIcons />}
      </div>
      <nav aria-label="Information" className="flex flex-wrap gap-5">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/docs">Docs</Link>
        <Link href="/get-started">Get started</Link>
        {!IS_DESKTOP && <Link href="/downloads">Downloads</Link>}
        <Link href="/updates">Updates</Link>
        {!IS_DESKTOP && <Link href="/beta">Join beta</Link>}
        <a href="/third-party-notices.txt">Licenses</a>
      </nav>
    </footer>
  );
}
export function AppShell({
  active,
  children,
  feedbackSessionId,
}: {
  active: NavKey;
  children: ReactNode;
  feedbackSessionId?: string;
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
          if (u) void syncAnalytics(u.id);
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
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-4 sm:px-6">
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
              {IS_DESKTOP ? "Desktop" : ".live"}
            </span>
          </Link>
          <div className="order-last flex w-full flex-wrap items-center gap-x-4 gap-y-2 lg:order-none lg:w-auto">
            {signedIn && (
              <FeedbackWidget
                target="product"
                sessionId={feedbackSessionId}
                getContext={() => ({ section: active })}
              />
            )}
            <nav aria-label="Main" className="flex flex-wrap gap-1">
              {[
                { label: "Practice", href: "/interviews" },
                ...(signedIn ? [{ label: "History", href: "/results" }] : []),
                { label: "Docs", href: "/docs" },
                { label: "Contribute", href: "/contribute" },
              ].map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={current === n.label ? "page" : undefined}
                  className={
                    "rounded-lg whitespace-nowrap px-3 py-2.5 text-sm no-underline " +
                    (current === n.label
                      ? "bg-[var(--color-panel-2)] font-semibold"
                      : "text-[var(--color-muted)]")
                  }
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <CommunityIconLink community="github" />
          {signedIn ? (
            <ProfileMenu
              admin={admin}
              settingsActive={active === "settings"}
              onLogout={
                IS_DESKTOP
                  ? undefined
                  : async () => {
                      try {
                        await api.logout();
                      } catch {
                        // Local credentials are cleared even when offline.
                      } finally {
                        disconnectAnalytics();
                        setSignedIn(false);
                        router.replace("/");
                      }
                    }
              }
            />
          ) : IS_DESKTOP ? (
            <span className="text-xs" role="status">
              Opening local profile…
            </span>
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
      <Footer />
    </>
  );
}

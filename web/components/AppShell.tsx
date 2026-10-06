"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { IS_DESKTOP } from "@/lib/desktop";
import { IS_MOCK } from "@/lib/api";
import { Button } from "./ui";
import { FeedbackWidget } from "./FeedbackWidget";
import { CommunityIconLink, CommunityIcons } from "./project/CommunityIcons";
import { ProfileMenu } from "./ProfileMenu";
import { AppVersion } from "./AppVersion";
import { BetaBadge } from "./BetaBadge";
import { HeaderSessionProvider, useHeaderSession } from "./HeaderSession";
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
        <span>This project is still in beta.</span>
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
type AppShellProps = {
  active: NavKey;
  children: ReactNode;
  feedbackSessionId?: string;
};
const sections = [
  {
    label: "Practice",
    href: "/interviews",
    routes: ["/interviews", "/interview", "/setup", "/packs", "/dashboard"],
  },
  {
    label: "History",
    href: "/results",
    routes: ["/results", "/report", "/feedback"],
  },
  { label: "Docs", href: "/docs", routes: ["/docs"] },
  { label: "Contribute", href: "/contribute", routes: ["/contribute"] },
];

export function AppShell(props: AppShellProps) {
  const session = useHeaderSession();
  // The root provider survives navigation. A local provider also allows the
  // shell to be rendered independently, for previews and component tests.
  return session ? (
    <AppShellContent {...props} />
  ) : (
    <HeaderSessionProvider>
      <AppShellContent {...props} />
    </HeaderSessionProvider>
  );
}

function AppShellContent({
  active,
  children,
  feedbackSessionId,
}: AppShellProps) {
  const session = useHeaderSession()!;
  const { user, refresh } = session;
  const signedIn = !!user;
  const router = useRouter();
  const pathname = usePathname() ?? "";
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const current = sections.find((section) =>
    section.routes.some(
      (route) => pathname === route || pathname.startsWith(route + "/"),
    ),
  )?.label;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="app-header no-print border-b border-[var(--color-line)] bg-[var(--color-panel)]">
        <div className="mx-auto flex max-w-[1160px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:gap-x-4 sm:px-6">
          <Link
            href="/"
            className="app-brand mr-auto flex items-center gap-2.5 text-lg font-semibold tracking-tight no-underline"
          >
            <span
              className="app-brand-mark grid h-8 w-8 place-items-center rounded-lg bg-[var(--color-accent)] text-[var(--color-panel)]"
              aria-hidden="true"
            >
              m
            </span>
            mockinterview
            <span className="hidden text-xs font-normal text-[var(--color-muted)] sm:inline">
              {IS_DESKTOP ? "Desktop" : ".live"}
            </span>
            <BetaBadge />
          </Link>
          <div className="order-last flex min-w-0 w-full items-center gap-2 lg:order-none lg:w-auto lg:gap-4">
            {signedIn && (
              <FeedbackWidget
                target="product"
                sessionId={feedbackSessionId}
                getContext={() => ({ section: active })}
              />
            )}
            <nav
              aria-label="Main"
              className="flex min-w-0 items-center gap-1 overflow-x-auto"
            >
              {sections
                .filter((section) => section.label !== "History" || signedIn)
                .map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    aria-current={current === n.label ? "page" : undefined}
                    className="app-nav-link"
                  >
                    {n.label}
                  </Link>
                ))}
            </nav>
          </div>
          <CommunityIconLink
            community="github"
            className="!hidden sm:!inline-flex"
          />
          <div className="header-account">
            {signedIn ? (
              <ProfileMenu
                admin={user?.role === "admin"}
                settingsActive={
                  pathname === "/settings" || pathname === "/settings/"
                }
                onLogout={
                  IS_DESKTOP
                    ? undefined
                    : async () => {
                        await session.logout();
                        router.replace("/");
                      }
                }
              />
            ) : user === undefined ? (
              <span className="header-account-loading" role="status">
                <span className="sr-only">Loading profile…</span>
              </span>
            ) : IS_DESKTOP ? (
              <span className="text-xs" role="status">
                Opening local profile…
              </span>
            ) : (
              <Button
                href="/login"
                variant="ghost"
                className="whitespace-nowrap px-3"
              >
                Sign in
              </Button>
            )}
          </div>
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
        {signedIn && user?.policies_required && active !== "public" && (
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

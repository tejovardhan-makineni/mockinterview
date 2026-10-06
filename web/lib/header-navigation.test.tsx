import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppShell, type NavKey } from "../components/AppShell";

const header = vi.hoisted(() => ({
  pathname: "/interviews",
  user: { id: "navigation-user", role: "user", policies_required: false } as {
    id: string;
    role: string;
    policies_required: boolean;
  } | null,
  refresh: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => header.pathname,
  useRouter: () => ({ replace: header.replace }),
}));
vi.mock("../components/HeaderSession", () => ({
  useHeaderSession: () => header,
  HeaderSessionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: { me: vi.fn(async () => header.user) },
}));
vi.mock("./analytics", () => ({ sendProjectCopy: vi.fn() }));
vi.mock("./desktop", () => ({ IS_DESKTOP: false }));

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  header.pathname = "/interviews";
  header.user = {
    id: "navigation-user",
    role: "user",
    policies_required: false,
  };
  document.body.innerHTML = '<div id="header-test-root"></div>';
  root = createRoot(document.querySelector("#header-test-root")!);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderPath(pathname: string, active: NavKey = "dashboard") {
  header.pathname = pathname;
  await act(async () => {
    root.render(<AppShell active={active}>Current page content</AppShell>);
  });
}

function navigationLinks() {
  const nav = document.querySelector('nav[aria-label="Main"]');
  expect(nav).not.toBeNull();
  return Array.from(nav!.querySelectorAll<HTMLAnchorElement>("a"));
}

function expectCurrent(label: string | null) {
  const links = navigationLinks();
  expect(
    links
      .filter((link) => link.getAttribute("aria-current") === "page")
      .map((link) => link.textContent?.trim()),
  ).toEqual(label ? [label] : []);
  for (const link of links) {
    if (link.textContent?.trim() !== label) {
      expect(link.hasAttribute("aria-current")).toBe(false);
    }
  }
}

describe("header navigation reflects the current URL", () => {
  const routes = [
    ["/interviews", "Practice"],
    ["/interview", "Practice"],
    ["/setup", "Practice"],
    ["/packs", "Practice"],
    ["/dashboard", "Practice"],
    ["/results", "History"],
    ["/report", "History"],
    ["/feedback", "History"],
    ["/docs", "Docs"],
    ["/contribute", "Contribute"],
  ] as const;

  it.each(routes)(
    "marks %s as %s, including trailing slashes and nested pages",
    async (path, label) => {
      for (const pathname of [path, `${path}/`, `${path}/details`]) {
        // The legacy prop deliberately disagrees for most routes: URL changes,
        // including browser back/forward, must determine the visible selection.
        await renderPath(pathname);
        expectCurrent(label);
      }
    },
  );

  it.each([
    "/docs-other",
    "/contribute-other",
    "/interviews-other",
    "/reports",
    "/settings",
    "/settings/",
    "/resume",
    "/resume/details",
    "/",
    "/login",
    "/privacy",
    "/downloads",
    "/beta",
  ])("does not select an unrelated section on %s", async (path) => {
    await renderPath(path);
    expectCurrent(null);
  });

  it.each([
    ["/docs/", "Docs"],
    ["/contribute/guide", "Contribute"],
  ])(
    "keeps the public %s section visibly current while signed out",
    async (path, label) => {
      header.user = null;
      await renderPath(path, "public");
      expectCurrent(label);
      expect(navigationLinks().map((link) => link.textContent?.trim())).toEqual(
        ["Practice", "Docs", "Contribute"],
      );
    },
  );

  it("moves the current marker when the pathname changes without remounting the shell", async () => {
    await renderPath("/interviews");
    expectCurrent("Practice");
    const docs = navigationLinks().find((link) => link.textContent === "Docs")!;
    const originalClasses = navigationLinks().map((link) => link.className);

    await renderPath("/docs");
    expectCurrent("Docs");
    expect(navigationLinks().find((link) => link.textContent === "Docs")).toBe(
      docs,
    );
    expect(docs.getAttribute("href")).toBe("/docs");

    await renderPath("/report/previous-interview");
    expectCurrent("History");
    // A browser-back pathname update restores Docs without stale prop state.
    await renderPath("/docs");
    expectCurrent("Docs");
    expect(navigationLinks().map((link) => link.className)).toEqual(
      originalClasses,
    );
  });
});

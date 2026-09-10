import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import AuthAction from "../app/auth/action/page";
import { account } from "./features/auth";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
vi.mock("../components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./features/auth", () => ({
  account: { reset: vi.fn(), verify: vi.fn() },
}));

let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="action-test"></div>';
  root = createRoot(document.querySelector("#action-test")!);
  vi.mocked(account.reset).mockResolvedValue({});
  vi.mocked(account.verify).mockResolvedValue({});
});
afterEach(async () => {
  await act(async () => root.unmount());
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("account action completion", () => {
  it.each([
    ["reset", "Your password has been changed.", "/login"],
    ["verify", "Your email has been verified.", "/interviews"],
  ])(
    "preserves the %s result after removing the action token",
    async (action, message, destination) => {
      window.history.replaceState(
        {},
        "",
        `/auth/action?action=${action}&token=synthetic-action-token`,
      );
      await act(async () => root.render(<AuthAction />));
      await act(async () => {
        document
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(account[action as "reset" | "verify"]).toHaveBeenCalledOnce();
      expect(window.location.search).toBe("");

      // Next's search-parameter hook rerenders when replaceState clears the URL.
      await act(async () => root.render(<AuthAction />));
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        message,
      );
      expect(document.querySelector("a")?.getAttribute("href")).toBe(
        destination,
      );
      expect(document.querySelector("form")).toBeNull();
    },
  );
});

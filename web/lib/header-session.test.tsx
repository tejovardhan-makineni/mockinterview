import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, StrictMode, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  HeaderSessionProvider,
  useHeaderSession,
  type HeaderSession,
} from "../components/HeaderSession";
import { api } from "./api";
import { disconnectAnalytics, syncAnalytics } from "./analytics";
import type { User } from "./features/auth";

vi.mock("./api", () => ({ api: { me: vi.fn(), logout: vi.fn() } }));
vi.mock("./analytics", () => ({
  syncAnalytics: vi.fn(async () => {}),
  disconnectAnalytics: vi.fn(),
}));

const first: User = { id: "first", email: "first@example.test", role: "user" };
const second: User = {
  id: "second",
  email: "second@example.test",
  role: "admin",
  policies_required: true,
};
let root: Root;
let current: HeaderSession | null;
function Probe({ refreshOnMount = true }: { refreshOnMount?: boolean }) {
  const session = useHeaderSession();
  useEffect(() => {
    current = session;
  }, [session]);
  const refresh = session?.refresh;
  useEffect(() => {
    if (refreshOnMount) void refresh?.();
  }, [refresh, refreshOnMount]);
  return (
    <output>
      {session === null
        ? "no provider"
        : session.user === undefined
          ? "loading"
          : (session.user?.id ?? "signed out")}
    </output>
  );
}
async function route(key: string, refreshOnMount = true) {
  await act(async () =>
    root.render(
      <HeaderSessionProvider>
        <Probe key={key} refreshOnMount={refreshOnMount} />
      </HeaderSessionProvider>,
    ),
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="header-session-test"></div>';
  root = createRoot(document.querySelector("#header-session-test")!);
  current = null;
  vi.mocked(api.me).mockResolvedValue(first);
  vi.mocked(api.logout).mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.resetAllMocks();
  vi.mocked(syncAnalytics).mockResolvedValue(undefined);
  vi.unstubAllGlobals();
});

describe("persistent header session", () => {
  it("settles lazy child refreshes under Strict Mode without duplicate analytics", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <HeaderSessionProvider>
            <Probe />
          </HeaderSessionProvider>
        </StrictMode>,
      ),
    );
    expect(current!.user).toEqual(first);
    expect(syncAnalytics).toHaveBeenCalledOnce();
  });

  it("returns null without a provider and fetches lazily when requested", async () => {
    await act(async () => root.render(<Probe />));
    expect(current).toBeNull();
    expect(document.querySelector("output")?.textContent).toBe("no provider");
    await route("initial", false);
    expect(current!.user).toBeUndefined();
    expect(api.me).not.toHaveBeenCalled();
    await act(async () => current!.refresh());
    expect(current!.user).toEqual(first);
  });

  it("keeps the known user across route-style child remounts while refreshing in the background", async () => {
    await route("practice");
    const refresh = current!.refresh;
    const logout = current!.logout;
    const next = deferred<User | null>();
    vi.mocked(api.me).mockReturnValueOnce(next.promise);
    await route("docs");
    expect(api.me).toHaveBeenCalledTimes(2);
    expect(current!.user).toEqual(first);
    expect(document.querySelector("output")?.textContent).toBe("first");
    expect(current!.refresh).toBe(refresh);
    expect(current!.logout).toBe(logout);
    await act(async () => next.resolve(second));
    expect(current!.user).toEqual(second);
    expect(syncAnalytics).toHaveBeenLastCalledWith(second.id);
    expect(current!.refresh).toBe(refresh);
    expect(current!.logout).toBe(logout);
  });

  it("ignores an older user response after a newer refresh completes", async () => {
    const older = deferred<User | null>();
    vi.mocked(api.me)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(second);
    await route("practice");
    await act(async () => current!.refresh());
    expect(current!.user).toEqual(second);
    await act(async () => older.resolve(first));
    expect(current!.user).toEqual(second);
    expect(syncAnalytics).toHaveBeenCalledOnce();
    expect(syncAnalytics).toHaveBeenCalledWith(second.id);
  });

  it("does not allow a pending refresh to restore the user after logout", async () => {
    await route("practice");
    const stale = deferred<User | null>();
    vi.mocked(api.me).mockReturnValueOnce(stale.promise);
    await act(async () => {
      void current!.refresh();
    });
    await act(async () => current!.logout());
    expect(current!.user).toBeNull();
    expect(disconnectAnalytics).toHaveBeenCalledOnce();
    await act(async () => stale.resolve(second));
    expect(current!.user).toBeNull();
    expect(syncAnalytics).toHaveBeenCalledOnce();
  });

  it("retains a known user on transient failures and resolves an unknown initial failure as signed out", async () => {
    await route("practice");
    vi.mocked(api.me).mockRejectedValueOnce(new Error("Offline"));
    await route("docs");
    expect(current!.user).toEqual(first);
    await act(async () => root.render(null));
    vi.mocked(api.me).mockRejectedValueOnce(new Error("Offline"));
    await route("fresh-provider");
    expect(current!.user).toBeNull();
    expect(document.querySelector("output")?.textContent).toBe("signed out");
  });

  it("accepts explicit signed-out results and subsequent user changes", async () => {
    vi.mocked(api.me).mockResolvedValueOnce(null);
    await route("public");
    expect(current!.user).toBeNull();
    await act(async () => current!.refresh());
    expect(current!.user).toEqual(first);
    vi.mocked(api.me).mockResolvedValueOnce(second);
    await act(async () => current!.refresh());
    expect(current!.user).toEqual(second);
    vi.mocked(api.me).mockResolvedValueOnce(null);
    await act(async () => current!.refresh());
    expect(current!.user).toBeNull();
  });

  it("clears the user and analytics even when logout fails, and skips refresh while logout is pending", async () => {
    await route("practice");
    const signingOut = deferred<void>();
    vi.mocked(api.logout).mockReturnValueOnce(signingOut.promise);
    await act(async () => {
      void current!.logout();
    });
    await act(async () => current!.refresh());
    expect(api.me).toHaveBeenCalledOnce();
    await act(async () => signingOut.reject(new Error("Offline")));
    expect(current!.user).toBeNull();
    expect(disconnectAnalytics).toHaveBeenCalledOnce();
  });
});

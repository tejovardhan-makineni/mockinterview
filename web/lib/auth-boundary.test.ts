import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { authHttp } from "./features/auth";
import { clearPrivateBrowserData } from "./http";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("mi_token", "token");
});
afterEach(() => vi.unstubAllGlobals());
describe("account data boundaries", () => {
  it("distinguishes an outage from an expired login", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(authHttp.me()).rejects.toMatchObject({ status: 0 });
    expect(localStorage.getItem("mi_token")).toBe("token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"detail":"expired"}', { status: 401 }),
        ),
    );
    expect(await authHttp.me()).toBeNull();
    expect(localStorage.getItem("mi_token")).toBeNull();
  });
  it("clears private artifacts in both stores without clearing appearance preference", () => {
    localStorage.setItem("mi_resume_data", "private");
    localStorage.setItem("mi.theme", "dark");
    sessionStorage.setItem("mi_workspace_session", "private");
    sessionStorage.setItem("mi_device_session", "device");
    clearPrivateBrowserData();
    expect(localStorage.getItem("mi_resume_data")).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem("mi.theme")).toBe("dark");
  });
});

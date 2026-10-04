import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const local = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getSession: vi.fn(),
  getReport: vi.fn(),
}));
vi.mock("./api", () => ({ IS_MOCK: false, api: local }));
const prefs = {
  shareAnalytics: false,
  shareInterviewResults: false,
  analyticsSince: 0,
  resultsSince: 0,
  theme: "system" as const,
};
let saved: typeof prefs;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DESKTOP", "1");
  vi.stubEnv(
    "NEXT_PUBLIC_API_BASE",
    "https://should-never-receive-interviews.example",
  );
  saved = { ...prefs };
  vi.stubGlobal("window", {
    location: { origin: "http://127.0.0.1:42189" },
    localStorage,
    dispatchEvent: vi.fn(),
    mockInterviewDesktop: {
      preferences: {
        get: vi.fn(async () => saved),
        set: vi.fn(async (update: Partial<typeof prefs>) => {
          saved = {
            ...saved,
            ...update,
            analyticsSince:
              update.shareAnalytics === false
                ? 0
                : update.shareAnalytics
                  ? 1
                  : saved.analyticsSince,
            resultsSince:
              update.shareInterviewResults === false
                ? 0
                : update.shareInterviewResults
                  ? 1
                  : saved.resultsSince,
          };
          return saved;
        }),
      },
    },
  });
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            token: "local-session",
            user: { id: "local-profile", email: "local@desktop.invalid" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("desktop boundary", () => {
  it("deduplicates bootstrap and ignores persisted web credentials", async () => {
    localStorage.setItem("mi_token", "old-hosted-secret");
    const { authHttp } = await import("./features/auth");
    const { getToken } = await import("./http");
    expect(getToken()).toBe("");
    const [a, b] = await Promise.all([authHttp.me(), authHttp.me()]);
    expect(a?.id).toBe("local-profile");
    expect(b).toEqual(a);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://127.0.0.1:42189/api/v1/desktop/bootstrap",
    );
    expect(getToken()).toBe("local-session");
    expect(localStorage.getItem("mi_token")).toBe("old-hosted-secret");
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).not.toHaveProperty(
      "Authorization",
    );
  });
  it("retries bootstrap after a service failure and keeps policy updates", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    const { authHttp } = await import("./features/auth");
    await expect(authHttp.me()).rejects.toThrow("cannot reach");
    expect((await authHttp.me())?.id).toBe("local-profile");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: "local-profile", policies_required: false }),
        { status: 200 },
      ),
    );
    await authHttp.acceptPolicies({
      adult_confirmed: true,
      terms_version: "v1",
      privacy_version: "v1",
    });
    expect((await authHttp.me())?.policies_required).toBe(false);
  });
  it("routes HTTP and sockets locally, sends auxiliary keys only locally, and clears them", async () => {
    const { req, wsBase, setDesktopModel, clearPrivateBrowserData } =
      await import("./http");
    setDesktopModel({
      provider: "openai",
      model: "selected",
      apiKey: "private-test-key",
    });
    await req("/api/v1/resume/review", { method: "POST" });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "http://127.0.0.1:42189/api/v1/resume/review",
    );
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({
      "X-Mockinterview-Key": "private-test-key",
    });
    expect(wsBase()).toBe("ws://127.0.0.1:42189");
    clearPrivateBrowserData();
    await req("/api/v1/profile");
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).not.toHaveProperty(
      "X-Mockinterview-Key",
    );
  });
  it("fails closed outside the bundled loopback origin", async () => {
    Object.assign(window.location, { origin: "https://mockinterview.live" });
    const { req } = await import("./http");
    await expect(req("/api/v1/sessions")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires analytics consent and a separate login, and excludes reports by default", async () => {
    const { setDesktopToken, setDesktopModel } = await import("./http");
    setDesktopToken("local-session");
    setDesktopModel({
      provider: "gemini",
      model: "selected",
      apiKey: "private-test-key",
    });
    const analytics = await import("./analytics");
    await analytics.syncAnalytics("local-profile");
    expect(local.listSessions).not.toHaveBeenCalled();
    await analytics.setAnalyticsConsent("local-profile", true);
    await analytics.syncAnalytics("local-profile");
    expect(fetch).not.toHaveBeenCalled();
    await analytics.connectAnalytics("hosted@example.test", "test-password");
    local.listSessions.mockResolvedValue([
      {
        id: "attempt",
        status: "complete",
        created_at: new Date().toISOString(),
      },
    ]);
    local.getSession.mockResolvedValue({
      runtime_metrics: { duration_seconds: 20, turn_count: 2, error_count: 0 },
    });
    await analytics.syncAnalytics("local-profile");
    expect(local.getReport).not.toHaveBeenCalled();
    const [target, request] = vi.mocked(fetch).mock.calls[1];
    expect(target).toBe(
      "http://127.0.0.1:42189/desktop/remote/api/v1/community/analytics",
    );
    expect(request?.headers).not.toHaveProperty("X-Mockinterview-Key");
    expect(JSON.parse(request!.body as string)).not.toHaveProperty("report");
    expect(JSON.parse(request!.body as string)).toMatchObject({
      source: "local",
      consent: true,
    });
  });
  it("withdrawal during report loading prevents that upload", async () => {
    const { setDesktopToken } = await import("./http");
    setDesktopToken("local-session");
    const analytics = await import("./analytics");
    await analytics.setAnalyticsConsent("local-profile", true);
    await analytics.setResultsConsent(true);
    await analytics.connectAnalytics("hosted@example.test", "test-password");
    local.listSessions.mockResolvedValue([
      {
        id: "attempt",
        status: "complete",
        created_at: new Date().toISOString(),
      },
    ]);
    local.getSession.mockResolvedValue({
      runtime_metrics: { duration_seconds: 20, turn_count: 2, error_count: 0 },
    });
    local.getReport.mockImplementation(async () => {
      await analytics.setResultsConsent(false);
      return {
        overall: 3,
        scored: true,
        coaching_md: "private-report",
        scores: [],
      };
    });
    await analytics.syncAnalytics("local-profile");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

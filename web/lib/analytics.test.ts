import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import {
  setAnalyticsConsent,
  syncAnalytics,
  sharedReport,
  deleteSharedAnalytics,
} from "./analytics";
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    listSessions: vi.fn(),
    getSession: vi.fn(),
    getReport: vi.fn(),
    getTranscript: vi.fn(),
  },
}));
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("mi_token", "synthetic-auth");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
describe("optional result sharing", () => {
  it("bounds large optional reports while preserving private originals", () => {
    const report = {
      overall: 3,
      scored: true,
      coaching_md: "漢".repeat(40000),
      scores: Array.from({ length: 30 }, () => ({
        dimension: "reasoning",
        score: 3,
        evidence: "漢".repeat(4000),
      })),
    };
    expect(
      new TextEncoder().encode(JSON.stringify(sharedReport(report as never)))
        .byteLength,
    ).toBeLessThanOrEqual(58000);
    expect(report.coaching_md).toHaveLength(40000);
  });
  it("does not upload sessions with malformed creation timestamps", async () => {
    setAnalyticsConsent("user", true);
    vi.mocked(api.listSessions).mockResolvedValue([
      { id: "session", created_at: "invalid", status: "complete" },
    ] as never);
    await syncAnalytics("user");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("withdrawal waits for an outstanding upload before deleting shared records", async () => {
    setAnalyticsConsent("user", true);
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: "session",
        created_at: new Date(Date.now() + 100).toISOString(),
        status: "interrupted",
      },
    ] as never);
    vi.mocked(api.getSession).mockResolvedValue({
      runtime_metrics: { error_count: 0, turn_count: 1, duration_seconds: 2 },
    } as never);
    let finishUpload!: (response: Response) => void;
    let uploadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(() => {
      uploadStarted();
      return new Promise<Response>((resolve) => {
        finishUpload = resolve;
      });
    });
    const sync = syncAnalytics("user");
    await started;
    setAnalyticsConsent("user", false);
    const deletion = deleteSharedAnalytics();
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    finishUpload({ ok: true } as Response);
    await sync;
    await deletion;
    expect(vi.mocked(fetch).mock.calls[1][1]?.method).toBe("DELETE");
  });
  it("does no work without consent", async () => {
    await syncAnalytics("user");
    expect(api.listSessions).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("shares a bounded report without credentials or transcript and deduplicates successes", async () => {
    setAnalyticsConsent("user", true);
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: "session",
        created_at: new Date(Date.now() + 100).toISOString(),
        status: "complete",
      },
    ] as never);
    vi.mocked(api.getSession).mockResolvedValue({
      provider: "openai",
      model: "selected",
      runtime_metrics: { error_count: 0, turn_count: 2, duration_seconds: 5 },
      api_key: "never-share",
    } as never);
    vi.mocked(api.getReport).mockResolvedValue({
      overall: 3,
      scored: true,
      coaching_md: "Practice tradeoffs.",
      scores: [],
      private: "never-share",
    } as never);
    vi.mocked(api.getTranscript).mockResolvedValue([
      { role: "candidate", text: "never-share", ts_ms: 1000 },
      { role: "interviewer", text: "private", ts_ms: 6000 },
    ]);
    await syncAnalytics("user");
    await syncAnalytics("user");
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({
      source: "web",
      consent: true,
      duration_seconds: 5,
      turn_count: 2,
      report: { overall: 3 },
    });
    expect(JSON.stringify(body)).not.toContain("never-share");
    setAnalyticsConsent("user", false);
    await syncAnalytics("user");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("quietly skips an unreachable server and allows a later retry", async () => {
    setAnalyticsConsent("user", true);
    vi.mocked(api.listSessions).mockResolvedValue([
      {
        id: "session",
        created_at: new Date(Date.now() + 100).toISOString(),
        status: "feedback_failed",
      },
    ] as never);
    vi.mocked(api.getSession).mockResolvedValue({
      provider: "gemini",
      runtime_metrics: { error_count: 2, turn_count: 0, duration_seconds: 0 },
    } as never);
    vi.mocked(api.getTranscript).mockResolvedValue([]);
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    await expect(syncAnalytics("user")).resolves.toBeUndefined();
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
    await syncAnalytics("user");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string),
    ).toMatchObject({ status: "failed", error_count: 2 });
  });
});

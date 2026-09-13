import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import SetupPage from "../app/setup/page";
import { api } from "./api";
import { DEFAULT_CONFIG } from "./features/profile";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    me: vi.fn(),
    getQuestion: vi.fn(),
    getConfig: vi.fn(),
    getUsage: vi.fn(),
    getResume: vi.fn(),
    getRequiredFeedback: vi.fn(),
    createSession: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams("q=access-scenario"),
}));
vi.mock("../components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../components/studio/Avatar3D", () => ({
  Avatar3D: () => null,
  INTERVIEWERS: [{ id: "alex", name: "Alex" }],
  interviewerName: () => "Alex",
}));
vi.mock("../components/studio/DeviceCheck", () => ({
  DeviceCheck: ({ onReady }: { onReady: (ready: boolean) => void }) => (
    <button onClick={() => onReady(true)}>Complete device check</button>
  ),
}));

const user = {
  id: "access-user",
  email: "tester@example.test",
  email_verified: true,
  policies_required: false,
  role: "user",
};
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="test-root"></div>';
  root = createRoot(document.querySelector("#test-root")!);
  vi.mocked(api.me).mockResolvedValue(user);
  vi.mocked(api.getQuestion).mockResolvedValue({
    id: "access-scenario",
    title: "Access scenario",
    modality: "conversational",
    track: "general",
    domain: "general",
    difficulty: "senior",
    minutes: 15,
    tags: [],
    areas: [],
    prompt: "Discuss a scenario",
    blurb: "",
    review_status: "preview",
  });
  vi.mocked(api.getConfig).mockResolvedValue(DEFAULT_CONFIG);
  vi.mocked(api.getResume).mockResolvedValue(null);
  vi.mocked(api.getRequiredFeedback).mockResolvedValue({ total: 0, items: [] });
  vi.mocked(api.getUsage).mockResolvedValue({
    funded_available: false,
    next_funded_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    next_start_at: new Date(Date.now() + 86400000).toISOString(),
    tester_unlimited: true,
  });
  vi.mocked(api.createSession).mockResolvedValue({
    id: "new-interview",
    question_id: "access-scenario",
    modality: "conversational",
    track: "general",
    status: "created",
    phase: "lobby",
    config: DEFAULT_CONFIG,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function button(label: string) {
  const result = Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
async function checkDevices() {
  await act(async () => button("Check devices").click());
  await act(async () => button("Complete device check").click());
}
async function acknowledgeVoice() {
  const label = Array.from(document.querySelectorAll("label")).find((item) =>
    item.textContent?.includes("my microphone audio will stream"),
  )!;
  await act(async () => label.querySelector("input")!.click());
}

describe("hosted tester setup access", () => {
  it("starts a verified tester despite daily and funded cooldowns", async () => {
    await act(async () => root.render(<SetupPage />));
    expect(document.body.textContent).toContain(
      "Tester access · unlimited interviews.",
    );
    expect(document.body.textContent).not.toContain("Next available:");
    await checkDevices();
    await acknowledgeVoice();
    expect(button("Start interview").disabled).toBe(false);
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      "access-scenario",
      expect.any(Object),
      undefined,
      expect.objectContaining({
        funding: "platform",
        voice_processing_acknowledged: true,
      }),
    );
    expect(navigation.push).toHaveBeenCalledWith("/interview?s=new-interview");
  });

  it("keeps the hosted allowance for accounts without tester access", async () => {
    vi.mocked(api.getUsage).mockResolvedValue({
      funded_available: false,
      next_start_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await act(async () => root.render(<SetupPage />));
    await checkDevices();
    await acknowledgeVoice();
    expect(document.body.textContent).toContain("Next available:");
    expect(button("Start interview").disabled).toBe(true);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("requires hosted email verification even with a tester entitlement", async () => {
    vi.mocked(api.me).mockResolvedValue({ ...user, email_verified: false });
    await act(async () => root.render(<SetupPage />));
    await checkDevices();
    await acknowledgeVoice();
    expect(document.body.textContent).toContain(
      "Verify your email before starting.",
    );
    expect(button("Start interview").disabled).toBe(true);
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it("requires voice acknowledgment after the tester completes device checks", async () => {
    await act(async () => root.render(<SetupPage />));
    await checkDevices();
    expect(button("Start interview").disabled).toBe(true);
    await acknowledgeVoice();
    expect(button("Start interview").disabled).toBe(false);
  });

  it("sends testers to the current policy review before device checks", async () => {
    vi.mocked(api.me).mockResolvedValue({ ...user, policies_required: true });
    await act(async () => root.render(<SetupPage />));
    await act(async () => button("Review terms to continue").click());
    expect(navigation.push).toHaveBeenCalledWith(
      expect.stringMatching(/^\/consent\?next=%2Fsetup/),
    );
    expect(api.createSession).not.toHaveBeenCalled();
  });
});

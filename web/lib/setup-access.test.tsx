import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import SetupPage from "../app/setup/page";
import { api } from "./api";
import { DEFAULT_CONFIG } from "./features/profile";

const desktopMode = vi.hoisted(() => ({ enabled: false }));
vi.mock("./desktop", () => ({
  get IS_DESKTOP() {
    return desktopMode.enabled;
  },
  desktopPreferences: () => ({
    shareInterviewResults: false,
    analyticsSince: 0,
  }),
}));
const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const route = vi.hoisted(() => ({ query: "q=access-scenario" }));
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    me: vi.fn(),
    getQuestion: vi.fn(),
    getPack: vi.fn(),
    getConfig: vi.fn(),
    getUsage: vi.fn(),
    getResume: vi.fn(),
    getRequiredFeedback: vi.fn(),
    createSession: vi.fn(),
    validateProvider: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(route.query),
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
  desktopMode.enabled = false;
  route.query = "q=access-scenario";
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
  vi.mocked(api.validateProvider).mockResolvedValue({
    valid: true,
    provider: "openai",
    model: "test-advanced-model",
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

async function change(
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const proto =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}
function field(label: string) {
  const el = Array.from(document.querySelectorAll("label")).find((element) =>
    element.textContent?.includes(label),
  )!;
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}
describe("hosted tester setup access", () => {
  it("keeps a manager pack's exact scope, independent of saved IC preferences", async () => {
    route.query = "pack=manager-path&round=leadership";
    const scenario = await api.getQuestion("access-scenario");
    vi.mocked(api.getQuestion).mockResolvedValue({
      ...scenario,
      role_track: "management",
      difficulty: "manager",
    });
    vi.mocked(api.getConfig).mockResolvedValue({
      ...DEFAULT_CONFIG,
      role_track: "individual_contributor",
      target_level: "principal",
    });
    vi.mocked(api.getPack).mockResolvedValue({
      id: "manager-path",
      name: "Manager practice",
      company: "",
      blurb: "Practice leading a team",
      areas: ["management"],
      track: "professional",
      rounds: [
        {
          id: "leadership",
          title: "Leadership decision",
          kind: "leadership",
          domain: "general",
          modality: "conversational",
          difficulty: "senior_manager",
          minutes: 20,
          focus: "Delegation",
          question_id: "access-scenario",
        },
      ],
    });
    await act(async () => root.render(<SetupPage />));
    const role = document.querySelector(
      'select[aria-label="Role track"]',
    ) as HTMLSelectElement;
    const level = document.querySelector(
      'select[aria-label="Target level"]',
    ) as HTMLSelectElement;
    expect(role.value).toBe("management");
    expect(level.value).toBe("senior_manager");
    expect(Array.from(level.options).map((o) => o.value)).toEqual([
      "manager",
      "senior_manager",
      "director",
    ]);
    await checkDevices();
    await acknowledgeVoice();
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        role_track: "management",
        target_level: "senior_manager",
      }),
      { packId: "manager-path", roundId: "leadership" },
      expect.objectContaining({ minutes: 20 }),
    );
  });
  it("restores an executive draft and keeps an unspecified scenario unlabeled", async () => {
    sessionStorage.setItem(
      "mi_setup_draft_access-scenario",
      JSON.stringify({
        expires: Date.now() + 60000,
        mode: "text",
        funding: "platform",
        provider: "gemini",
        model: "",
        minutes: 20,
        config: { role_track: "executive", target_level: "vp" },
      }),
    );
    await act(async () => root.render(<SetupPage />));
    const role = document.querySelector(
      'select[aria-label="Role track"]',
    ) as HTMLSelectElement;
    const level = document.querySelector(
      'select[aria-label="Target level"]',
    ) as HTMLSelectElement;
    expect(role.value).toBe("executive");
    expect(level.value).toBe("vp");
    await change(role, "");
    expect(role.value).toBe("");
    expect(level.value).toBe("vp");
    await change(role, "individual_contributor");
    expect(level.value).toBe("mid");
    expect(Array.from(level.options).map((o) => o.value)).toContain(
      "principal",
    );
  });
  it("desktop requires a validated personal key and offers no hosted funding", async () => {
    desktopMode.enabled = true;
    sessionStorage.setItem(
      "mi_setup_draft_access-scenario",
      JSON.stringify({
        funding: "platform",
        provider: "openai",
        model: "",
        mode: "text",
        minutes: 15,
        config: DEFAULT_CONFIG,
      }),
    );
    await act(async () => root.render(<SetupPage />));
    expect(document.body.textContent).toContain(
      "No free interviews are included",
    );
    expect(document.querySelector('option[value="platform"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Tester access");
    expect(document.querySelector('a[href="/beta"]')).toBeNull();
    await change(field("Provider"), "openai");
    await checkDevices();
    expect(button("Start interview").disabled).toBe(true);
    await change(field("API key"), "desktop-test-key");
    await act(async () => button("Check model connection").click());
    expect(button("Start interview").disabled).toBe(false);
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      undefined,
      expect.objectContaining({ funding: "byok", api_key: "desktop-test-key" }),
    );
  });

  it("requires a custom brief and sends free-text goals and seniority", async () => {
    route.query = "custom=1";
    await act(async () => root.render(<SetupPage />));
    await act(async () => button("Check devices").click());
    expect(document.body.textContent).toContain("Add your profession");
    await change(field("Profession"), "Marine biologist");
    await change(field("Experience level"), "Senior research lead");
    await change(field("What would you like"), "Defend a field study design");
    await change(
      field("Your questions"),
      "How would you handle sampling bias?",
    );
    await checkDevices();
    await acknowledgeVoice();
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      "",
      expect.any(Object),
      undefined,
      expect.objectContaining({
        custom: expect.objectContaining({
          profession: "Marine biologist",
          level: "Senior research lead",
          goal: "Defend a field study design",
          questions: "How would you handle sampling bias?",
        }),
      }),
    );
  });
  it("lets a validated personal key start while the free allowance is exhausted", async () => {
    vi.mocked(api.getUsage).mockResolvedValue({
      funded_available: false,
      next_start_at: new Date(Date.now() + 86400000).toISOString(),
    });
    await act(async () => root.render(<SetupPage />));
    await change(field("Practice access"), "byok");
    await change(field("Provider"), "openai");
    await change(field("API key"), "synthetic-personal-key");
    await act(async () => button("Check model connection").click());
    await checkDevices();
    expect(button("Start interview").disabled).toBe(false);
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      undefined,
      expect.objectContaining({
        funding: "byok",
        provider: "openai",
        model: "test-advanced-model",
        mode: "text",
      }),
    );
  });
  it("shows the pinned scenario specialist and brief while starting through its pack", async () => {
    route.query = "pack=security-practice&round=triage";
    vi.mocked(api.getPack).mockResolvedValue({
      id: "security-practice",
      name: "Security practice",
      company: "",
      blurb: "Practice path",
      areas: ["cybersecurity"],
      track: "professional",
      rounds: [
        {
          id: "triage",
          title: "Security triage",
          kind: "incident",
          domain: "security_operations",
          modality: "conversational",
          difficulty: "entry",
          minutes: 20,
          focus: "Triage safely",
          question_id: "access-scenario",
        },
      ],
    });
    const scenario = await api.getQuestion("access-scenario");
    vi.mocked(api.getQuestion).mockResolvedValue({
      ...scenario,
      prompt: "Review the fictional security report.",
      agent: {
        id: "security",
        name: "Cybersecurity interviewer",
        summary: "Practice safe incident triage.",
      },
    });
    await act(async () => root.render(<SetupPage />));
    expect(document.body.textContent).toContain("Cybersecurity interviewer");
    expect(document.body.textContent).toContain(
      "Review the fictional security report.",
    );
    await checkDevices();
    await acknowledgeVoice();
    await act(async () => button("Start interview").click());
    expect(api.createSession).toHaveBeenCalledWith(
      "",
      expect.any(Object),
      { packId: "security-practice", roundId: "triage" },
      expect.any(Object),
    );
  });

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

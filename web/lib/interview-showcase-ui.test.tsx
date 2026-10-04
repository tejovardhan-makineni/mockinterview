import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InterviewShowcase } from "../components/project/InterviewShowcase";
import { api } from "./api";
import { SHOWCASE_SLIDES } from "./interview-showcase";
import type { QuestionSummary } from "./features/catalog";
import type { Profession } from "./features/profile";

vi.mock("./api", () => ({
  api: { listQuestions: vi.fn(), listProfessions: vi.fn() },
}));
vi.mock("../components/project/showcase.module.css", () => ({ default: {} }));

const nursing: QuestionSummary = {
  id: "nursing-practice",
  title: "Prioritize a busy shift",
  areas: ["nursing"],
  domain: "prioritization",
  format_id: "incident-simulation",
  format_name: "Incident simulation",
  track: "professional",
  modality: "conversational",
  difficulty: "entry",
  tags: [],
  blurb: "Explain your priorities and how you would ask for help.",
  prompt: "Explain your priorities.",
};
const software: QuestionSummary = {
  ...nursing,
  id: "coding-practice",
  title: "Implement a cache",
  areas: ["software_engineering"],
  domain: "coding",
  format_id: "coding",
  format_name: "Coding",
  track: "engineering",
  modality: "coding",
  blurb: "Explain your design and test the implementation.",
  prompt: "Implement a cache.",
};
const professions: Profession[] = [
  {
    key: "nursing",
    label: "Nursing",
    family: "healthcare",
    family_label: "Healthcare",
    count: 1,
    tracks: ["professional"],
  },
  {
    key: "software_engineering",
    label: "Software Engineering",
    family: "technology",
    family_label: "Technology",
    count: 2,
    tracks: ["engineering"],
  },
];

let root: Root;
let reducedMotion: boolean;
let hidden: boolean;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reducedMotion = false;
  hidden = false;
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    get matches() {
      return reducedMotion;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  document.body.innerHTML = '<div id="test-root"></div>';
  root = createRoot(document.querySelector("#test-root")!);
  vi.mocked(api.listQuestions).mockResolvedValue([
    nursing,
    software,
    { ...software, id: "second-coding-practice", title: "Explore a graph" },
  ]);
  vi.mocked(api.listProfessions).mockResolvedValue(professions);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderShowcase() {
  await act(async () => root.render(<InterviewShowcase />));
}

async function elapse(milliseconds = 7000) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
}

function button(label: string) {
  const control = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!control) throw new Error(`Missing accessible control: ${label}`);
  return control;
}

function current() {
  return {
    profession: document.querySelector("h2")?.textContent,
    scenario: document.querySelector("h3")?.textContent,
    href: document.querySelector("a")?.getAttribute("href"),
  };
}

describe("homepage interview preview controls", () => {
  it("rotates the profession, matching activity, and real interview destination together", async () => {
    await renderShowcase();
    expect(current()).toEqual({
      profession: "Nursing",
      scenario: "Prioritize a busy shift",
      href: "/setup?q=nursing-practice",
    });
    expect(document.body.textContent).toContain("Respond and prioritize");

    await elapse();
    expect(current()).toEqual({
      profession: "Software Engineering",
      scenario: "Implement a cache",
      href: "/setup?q=coding-practice",
    });
    expect(document.body.textContent).toContain("Write and test code");
    // Autoplay must not repeatedly interrupt a screen reader.
    expect(document.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("keeps a paused or manually chosen scenario in place until explicitly resumed", async () => {
    await renderShowcase();
    await act(async () => button("Pause interview previews").click());
    const paused = current();
    await elapse(21000);
    expect(current()).toEqual(paused);

    await act(async () => {
      const select = document.querySelector("select")!;
      select.value = "software_engineering";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(current().href).toBe("/setup?q=coding-practice");
    await act(async () => button("Next interview preview").click());
    expect(current().href).toBe("/setup?q=second-coding-practice");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Software Engineering: Explore a graph",
    );
    await elapse(21000);
    expect(current().href).toBe("/setup?q=second-coding-practice");

    await act(async () => button("Resume interview previews").click());
    await elapse();
    expect(current().href).toBe("/setup?q=coding-practice");
  });

  it("stops moving when a keyboard user focuses the preview", async () => {
    await renderShowcase();
    await act(async () => document.querySelector("select")!.focus());
    const reading = current();
    await elapse(14000);
    expect(current()).toEqual(reading);
    expect(button("Resume interview previews")).toBeTruthy();
    await act(async () => document.querySelector("select")!.blur());
    await elapse();
    expect(current()).toEqual(reading);
  });

  it("respects reduced motion while keeping manual navigation available", async () => {
    reducedMotion = true;
    await renderShowcase();
    await elapse(21000);
    expect(current().href).toBe("/setup?q=nursing-practice");
    expect(
      document.querySelector('button[aria-label="Pause interview previews"]'),
    ).toBeNull();
    await act(async () => button("Next interview preview").click());
    expect(current().href).toBe("/setup?q=coding-practice");
    await elapse(14000);
    expect(current().href).toBe("/setup?q=coding-practice");
  });

  it("stops autoplay in a hidden tab and resumes only when visible", async () => {
    await renderShowcase();
    await act(async () => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await elapse(14000);
    expect(current().href).toBe("/setup?q=nursing-practice");
    await act(async () => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await elapse();
    expect(current().href).toBe("/setup?q=coding-practice");
  });

  it("retains useful previews and working destinations when the public API is unavailable", async () => {
    vi.mocked(api.listQuestions).mockRejectedValue(new Error("Offline"));
    await renderShowcase();
    expect(current().scenario).toBe(SHOWCASE_SLIDES[0].title);
    expect(current().href).toBe(`/setup?q=${SHOWCASE_SLIDES[0].id}`);
    await act(async () => button("Next interview preview").click());
    expect(current().scenario).toBe(SHOWCASE_SLIDES[1].title);
    expect(current().href).toBe(`/setup?q=${SHOWCASE_SLIDES[1].id}`);
    expect(document.querySelectorAll("select option").length).toBeGreaterThan(
      2,
    );
  });

  it("recovers when a selected offline profession is absent from the refreshed catalog", async () => {
    let resolveQuestions!: (questions: QuestionSummary[]) => void;
    vi.mocked(api.listQuestions).mockReturnValue(
      new Promise((resolve) => {
        resolveQuestions = resolve;
      }),
    );
    await renderShowcase();
    await act(async () => {
      const select = document.querySelector("select")!;
      select.value = "medicine";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(document.querySelector("select")!.value).toBe("medicine");
    expect(current().profession).toBe("Medicine");

    await act(async () => resolveQuestions([nursing, software]));
    expect(document.querySelector("select")!.value).toBe("");
    expect(current()).toEqual({
      profession: "Nursing",
      scenario: "Prioritize a busy shift",
      href: "/setup?q=nursing-practice",
    });
    // Refresh must preserve the user's decision to stop automatic movement.
    await elapse(14000);
    expect(current().href).toBe("/setup?q=nursing-practice");
    await act(async () => button("Next interview preview").click());
    expect(current().href).toBe("/setup?q=coding-practice");
  });
});

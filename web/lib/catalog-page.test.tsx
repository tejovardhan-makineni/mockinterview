import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import Catalog from "../app/interviews/page";
import { api } from "./api";
import type { QuestionSummary } from "./features/catalog";

vi.mock("./api", () => ({
  IS_MOCK: false,
  api: { listQuestions: vi.fn(), listProfessions: vi.fn() },
}));
vi.mock("../components/AppShell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => children,
}));
const software: QuestionSummary = {
  id: "system-design",
  title: "Build a service",
  domain: "system_design",
  format_id: "work-sample",
  format_name: "Work-sample defense",
  track: "engineering",
  areas: ["software_engineering"],
  modality: "system_design",
  difficulty: "senior",
  tags: ["reliability"],
  blurb: "Discuss your architecture.",
  prompt: "Design a reliable service.",
  agent: {
    id: "software",
    name: "Software interviewer",
    summary: "Explore engineering tradeoffs.",
  },
};
const classroom: QuestionSummary = {
  ...software,
  id: "teaching-practice",
  title: "Support a classroom",
  domain: "classroom_management",
  format_id: "role-play",
  format_name: "Stakeholder simulation",
  track: "professional",
  areas: ["education"],
  modality: "conversational",
  difficulty: "entry",
  tags: ["learning"],
  blurb: "Meet different learning needs.",
  prompt: "Support an inclusive class.",
  agent: {
    id: "education",
    name: "Education interviewer",
    summary: "Explore inclusive teaching and learning.",
  },
};
const professions = [
  {
    key: "software_engineering",
    label: "Software Engineering",
    count: 1,
    tracks: ["engineering"],
    family: "technology",
    family_label: "Technology & Data",
    aliases: ["SWE"],
    agent: software.agent,
  },
  {
    key: "education",
    label: "Education & Teaching",
    count: 1,
    tracks: ["professional"],
    family: "education",
    family_label: "Learning & Public Service",
    aliases: ["teacher"],
    agent: classroom.agent,
  },
];
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="test-root"></div>';
  root = createRoot(document.querySelector("#test-root")!);
  vi.mocked(api.listQuestions).mockResolvedValue([software, classroom]);
  vi.mocked(api.listProfessions).mockResolvedValue(professions);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
function select(label: string) {
  return document.querySelector(
    `select[aria-label="${label}"]`,
  )! as HTMLSelectElement;
}
async function choose(label: string, value: string) {
  await act(async () => {
    const control = select(label);
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function search(value: string) {
  await act(async () => {
    const input = document.querySelector("input[type=search]")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function button(label: string) {
  const result = [...document.querySelectorAll("button")].find((item) =>
    item.textContent?.includes(label),
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}
function titles() {
  return [...document.querySelectorAll("h2")].map((h) => h.textContent);
}

describe("interview catalog", () => {
  it("uses registry career families and profession labels and preserves scenario links", async () => {
    await act(async () => root.render(<Catalog />));
    expect(select("Career family").textContent).toContain(
      "Learning & Public Service",
    );
    expect(select("Profession").textContent).toContain("Education & Teaching");
    expect(
      document.querySelector('a[href="/setup?q=teaching-practice"]'),
    ).not.toBeNull();
    await choose("Career family", "education");
    expect(select("Profession").textContent).not.toContain(
      "Software Engineering",
    );
    expect(titles()).toEqual([classroom.title]);
    await choose("Profession", "education");
    expect(document.body.textContent).toContain(classroom.agent!.summary);
    await choose("Career family", "technology");
    expect(select("Profession").value).toBe("");
    expect(titles()).toEqual([software.title]);
  });
  it("uses actual format labels and separates topic and workspace filters", async () => {
    await act(async () => root.render(<Catalog />));
    expect(select("Interview format").textContent).toContain(
      "Stakeholder simulation",
    );
    expect(select("Interview format").textContent).not.toContain(
      "Classroom Management",
    );
    expect(select("Skill / topic").textContent).toContain(
      "Classroom Management",
    );
    await choose("Interview format", "role-play");
    expect(titles()).toEqual([classroom.title]);
    await choose("Workspace", "written");
    expect(document.body.textContent).toContain("A different search may help.");
    await act(async () => button("Clear filters").click());
    expect(select("Interview format").value).toBe("");
    expect(select("Workspace").value).toBe("");
    expect(titles()).toEqual([software.title, classroom.title]);
  });
  it("searches role aliases beyond the initial page of scenarios", async () => {
    const bank = Array.from({ length: 30 }, (_, index) => ({
      ...software,
      id: `software-${index}`,
    }));
    vi.mocked(api.listQuestions).mockResolvedValue([...bank, classroom]);
    await act(async () => root.render(<Catalog />));
    expect(titles()).toHaveLength(24);
    await search("teacher");
    expect(titles()).toEqual([classroom.title]);
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "1 scenario",
    );
    await act(async () => button("Clear filters").click());
    expect(titles()).toHaveLength(24);
    await act(async () => button("Show more interviews").click());
    expect(titles()).toHaveLength(31);
    await search("SWE");
    expect(titles()).toHaveLength(24);
  });
  it("retries both resources when the profession registry fails", async () => {
    vi.mocked(api.listProfessions).mockRejectedValueOnce(
      new Error("Profession registry unavailable"),
    );
    await act(async () => root.render(<Catalog />));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Profession registry unavailable",
    );
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "could not load",
    );
    await act(async () => button("Try again").click());
    expect(api.listQuestions).toHaveBeenCalledTimes(2);
    expect(api.listProfessions).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(titles()).toEqual([software.title, classroom.title]);
  });
});

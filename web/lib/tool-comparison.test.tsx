import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InterviewCheckIn } from "../components/InterviewCheckIn";
import { AdminFeedbackSuggestions } from "../components/AdminFeedbackSuggestions";
import { api } from "./api";
import type {
  InterviewFeedbackEnvelope,
  InterviewFeedbackInput,
  ToolComparison,
} from "./features/feedback";
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    getInterviewFeedback: vi.fn(),
    saveInterviewFeedback: vi.fn(),
    getFeedbackSuggestions: vi.fn(),
  },
}));
const ids = [
  "usability_ease",
  "interviewer_realism",
  "subject_probe_quality",
  "challenge_fit",
  "report_actionability",
  "disruption_severity",
];
const answers = Object.fromEntries(ids.map((id) => [id, "unable_to_judge"]));
const example: ToolComparison = {
  version: "tool-comparison-v1",
  prior_use: "yes",
  tool_names: "A tool I tried",
  preference: "other_tools_better",
  details: "The other tool let me revisit each answer.",
};
function envelope(
  response: InterviewFeedbackInput | null = null,
): InterviewFeedbackEnvelope {
  return {
    required: !response,
    eligible: true,
    report_available: true,
    questionnaire: {
      version: "post-interview-v1",
      comparison_version: "tool-comparison-v1",
      subject_key: "general",
      subject_label: "General reasoning",
      questions: ids.map((id) => ({
        id,
        prompt: id,
        options: [
          { value: "1", label: "Low" },
          { value: "5", label: "High" },
          { value: "unable_to_judge", label: "Unable to judge" },
        ],
      })),
    },
    response: response
      ? {
          ...response,
          submitted_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        }
      : null,
  };
}
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="comparison-root"></div>';
  root = createRoot(document.querySelector("#comparison-root")!);
  vi.mocked(api.getInterviewFeedback).mockResolvedValue(envelope());
  vi.mocked(api.saveInterviewFeedback).mockImplementation(async (_id, input) =>
    envelope(input),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () =>
    root.render(<InterviewCheckIn key="first" sessionId="first" />),
  );
}
async function radio(value: string) {
  await act(async () =>
    document
      .querySelector<HTMLInputElement>(`input[type="radio"][value="${value}"]`)!
      .click(),
  );
}
async function six() {
  await act(async () =>
    document
      .querySelectorAll<HTMLInputElement>(
        'input[required][value="unable_to_judge"]',
      )
      .forEach((i) => i.click()),
  );
}
const saveButton = () =>
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
async function clickButton(text: string) {
  await act(async () =>
    Array.from(document.querySelectorAll("button"))
      .find((b) => b.textContent?.trim() === text)!
      .click(),
  );
}
function field(label: string) {
  return Array.from(document.querySelectorAll("label")).find((l) =>
    l.textContent?.trim().startsWith(label),
  )!.control as HTMLInputElement | HTMLTextAreaElement;
}
async function type(label: string, text: string) {
  await act(async () => {
    const node = field(label);
    const proto =
      node.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function save() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
function lastComparison() {
  return vi.mocked(api.saveInterviewFeedback).mock.calls.at(-1)![1].comparison;
}
describe("optional other-tool comparison", () => {
  it("has no default selection and lets all six unable answers save without any comparison", async () => {
    await mount();
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    expect(document.querySelectorAll("input[required]")).toHaveLength(18);
    await six();
    expect(saveButton().disabled).toBe(false);
    await save();
    expect(lastComparison()).toBeNull();
    expect(document.body.textContent).toContain("No comparison saved");
  });
  it("does not add an unsupported field when the API omits comparison capability", async () => {
    const old = envelope();
    delete old.questionnaire.comparison_version;
    vi.mocked(api.getInterviewFeedback).mockResolvedValueOnce(old);
    await mount();
    expect(document.body.textContent).not.toContain(
      "Have you used another interview-practice tool?",
    );
    await six();
    await save();
    expect(
      vi.mocked(api.saveInterviewFeedback).mock.calls[0][1],
    ).not.toHaveProperty("comparison");
  });
  it("accepts yes with no tool names, rating or details while still requiring the original six answers", async () => {
    await mount();
    await radio("yes");
    expect(saveButton().disabled).toBe(true);
    expect(field("Which tools").required).toBe(false);
    await six();
    await save();
    expect(lastComparison()).toEqual({
      version: "tool-comparison-v1",
      prior_use: "yes",
      tool_names: "",
      preference: "",
      details: "",
    });
  });
  it.each(["no", "prefer_not_to_say"] as const)(
    "switching from yes to %s discards hidden text and rating",
    async (prior_use) => {
      await mount();
      await six();
      await radio("yes");
      await type("Which tools", "Previously typed name");
      await type("What worked better", "Previously typed detail");
      await radio("other_tools_better");
      await radio(prior_use);
      expect(document.body.textContent).not.toContain(
        "Which tools have you tried?",
      );
      await save();
      expect(lastComparison()).toEqual({
        version: "tool-comparison-v1",
        prior_use,
        tool_names: "",
        preference: "",
        details: "",
      });
    },
  );
  it("can clear a comparison rating without losing optional text, or clear the whole section", async () => {
    await mount();
    await six();
    await radio("yes");
    await type("Which tools", "One unnamed example");
    await radio("mockinterview_better");
    await clickButton("Clear comparison rating");
    expect(field("Which tools").value).toBe("One unnamed example");
    expect(
      document.querySelector<HTMLInputElement>(
        'input[value="mockinterview_better"]',
      )!.checked,
    ).toBe(false);
    await clickButton("Clear and skip tool comparison");
    expect(document.querySelector('input[value="yes"]:checked')).toBeNull();
    await save();
    expect(lastComparison()).toBeNull();
  });
  it("preserves the entire optional draft on save failure and confirms the server response on retry", async () => {
    vi.mocked(api.saveInterviewFeedback).mockRejectedValueOnce(
      new Error("Try later"),
    );
    await mount();
    await six();
    await radio("yes");
    await type("Which tools", example.tool_names);
    await type("What worked better", example.details);
    await radio(example.preference);
    await save();
    expect(field("Which tools").value).toBe(example.tool_names);
    expect(field("What worked better").value).toBe(example.details);
    expect(
      document.querySelector<HTMLInputElement>(
        'input[value="other_tools_better"]',
      )!.checked,
    ).toBe(true);
    expect(saveButton().disabled).toBe(false);
    await save();
    expect(lastComparison()).toEqual(example);
    expect(document.body.textContent).toContain("The other tools were better");
    expect(document.querySelector("form")).toBeNull();
  });
  it("loads saved values, cancels edits, and persists an explicit clear without carrying data to another session", async () => {
    vi.mocked(api.getInterviewFeedback).mockResolvedValueOnce(
      envelope({ version: "post-interview-v1", answers, comparison: example }),
    );
    await mount();
    expect(document.body.textContent).toContain(example.details);
    await clickButton("Edit responses (optional)");
    expect(field("Which tools").value).toBe(example.tool_names);
    await type("Which tools", "Changed only locally");
    await clickButton("Cancel edits");
    expect(document.body.textContent).toContain(example.tool_names);
    expect(document.body.textContent).not.toContain("Changed only locally");
    await clickButton("Edit responses (optional)");
    await clickButton("Clear and skip tool comparison");
    await save();
    expect(lastComparison()).toBeNull();
    expect(document.body.textContent).toContain("No comparison saved");
    await act(async () =>
      root.render(<InterviewCheckIn key="second" sessionId="second" />),
    );
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
  });
  it("counts Unicode limits without truncation and allows clearing overlong optional input", async () => {
    await mount();
    await six();
    await radio("yes");
    await type("Which tools", "🙂".repeat(300));
    await type("What worked better", "🙂".repeat(1000));
    expect(saveButton().disabled).toBe(false);
    expect(field("Which tools").value).toHaveLength(600);
    expect(field("What worked better").value).toHaveLength(2000);
    await type("Which tools", "🙂".repeat(301));
    expect(saveButton().disabled).toBe(true);
    expect(field("Which tools").value).toHaveLength(602);
    await type("Which tools", "");
    await type("What worked better", "🙂".repeat(1001));
    expect(saveButton().disabled).toBe(true);
    expect(field("What worked better").value).toHaveLength(2002);
    await clickButton("Clear and skip tool comparison");
    expect(saveButton().disabled).toBe(false);
    await save();
    expect(lastComparison()).toBeNull();
  });
  it("shows comparison-only administrator suggestions as plain text", async () => {
    const comparison = {
      ...example,
      tool_names: "<script>privateTool()</script>",
      details: "<img src=x onerror=unsafe()>",
    };
    vi.mocked(api.getFeedbackSuggestions).mockResolvedValueOnce({
      items: [
        {
          session_id: "one",
          version: "post-interview-v1",
          question_title: "Scenario",
          subject_key: "subject",
          subject_label: "Subject",
          mode: "text",
          provider: "stub",
          status: "complete",
          comment: "",
          comparison,
          share_transcript: false,
          submitted_at: "2026-09-10T00:00:00Z",
          updated_at: "2026-09-10T00:00:00Z",
        },
      ],
      next_cursor: null,
    });
    await act(async () => root.render(<AdminFeedbackSuggestions />));
    expect(document.body.textContent).toContain(comparison.tool_names);
    expect(document.body.textContent).toContain(comparison.details);
    expect(document.querySelector("script,img")).toBeNull();
    expect(document.body.textContent).not.toContain(
      "No optional comments or tool comparisons yet.",
    );
  });
});

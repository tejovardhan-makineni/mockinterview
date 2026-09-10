import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useRequiredFeedback,
  feedbackChanged,
} from "../components/RequiredFeedbackNotice";
import { AdminFeedbackSuggestions } from "../components/AdminFeedbackSuggestions";
import { InterviewCheckIn } from "../components/InterviewCheckIn";
import FeedbackMetricsPage from "../app/admin/feedback/page";
import SetupPage from "../app/setup/page";
import { api } from "./api";
import type {
  InterviewFeedbackEnvelope,
  InterviewFeedbackMetrics,
} from "./features/feedback";
import { DEFAULT_CONFIG } from "./features/profile";
import { metricsCSV } from "./interviewFeedback";
vi.mock("./api", () => ({
  IS_MOCK: false,
  api: {
    getInterviewFeedback: vi.fn(),
    saveInterviewFeedback: vi.fn(),
    getRequiredFeedback: vi.fn(),
    getInterviewFeedbackMetrics: vi.fn(),
    getFeedbackSuggestions: vi.fn(),
    me: vi.fn(),
    getConfig: vi.fn(),
    getUsage: vi.fn(),
    getResume: vi.fn(),
    getQuestion: vi.fn(),
    createSession: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("q=synthetic-question"),
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
  DeviceCheck: () => null,
}));
const questionIDs = [
  "usability_ease",
  "interviewer_realism",
  "subject_probe_quality",
  "challenge_fit",
  "report_actionability",
  "disruption_severity",
];
function envelope(): InterviewFeedbackEnvelope {
  return {
    required: true,
    eligible: true,
    report_available: false,
    questionnaire: {
      version: "post-interview-v1",
      subject_key: "technical",
      subject_label: "Technical reasoning",
      questions: questionIDs.map((id) => ({
        id,
        prompt: id.replaceAll("_", " "),
        options: [
          ...Array.from({ length: 5 }, (_, i) => ({
            value: String(i + 1),
            label: `Rating ${i + 1}`,
          })),
          { value: "unable_to_judge", label: "Unable to judge" },
          ...(id === "report_actionability"
            ? [
                { value: "report_not_read", label: "Report not read" },
                { value: "report_unavailable", label: "Report unavailable" },
              ]
            : []),
        ],
      })),
    },
    response: null,
  };
}
const allUnable = Object.fromEntries(
  questionIDs.map((id) => [id, "unable_to_judge"]),
);
function saved(): InterviewFeedbackEnvelope {
  return {
    ...envelope(),
    required: false,
    response: {
      version: "post-interview-v1",
      answers: allUnable,
      comment: "",
      share_transcript: false,
      submitted_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    },
  };
}
const metrics: InterviewFeedbackMetrics = {
  schema_version: "post-interview-v1",
  days: 30,
  group_by: "subject",
  generated_at: "2026-09-10T00:00:00Z",
  totals: {
    eligible_sessions: 2,
    responded_sessions: 1,
    pending_sessions: 1,
    response_rate: 0.5,
  },
  groups: [
    {
      key: "technical",
      label: "=UNTRUSTED()",
      eligible_sessions: 2,
      responded_sessions: 1,
      pending_sessions: 1,
      response_rate: 0.5,
      questions: [
        {
          id: "usability_ease",
          label: "Ease",
          distribution: { "1": 0, unable_to_judge: 1 },
          answered_count: 0,
          unrated_count: 1,
          mean: null,
          favorable_count: 0,
          favorable_label: "4 or 5",
          favorable_rate: null,
        },
      ],
    },
  ],
  note: "Synthetic aggregate fixture",
};
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="test-root"></div>';
  root = createRoot(document.querySelector("#test-root")!);
  vi.mocked(api.getInterviewFeedback).mockResolvedValue(envelope());
  vi.mocked(api.saveInterviewFeedback).mockResolvedValue(saved());
  vi.mocked(api.getFeedbackSuggestions).mockResolvedValue({
    items: [],
    next_cursor: null,
  });
  vi.mocked(api.getRequiredFeedback).mockResolvedValue({ items: [], total: 0 });
  vi.mocked(api.me).mockResolvedValue({
    id: "synthetic-user",
    email: "synthetic@example.test",
    email_verified: true,
    role: "user",
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});
const submit = () =>
  document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
async function chooseUnable() {
  await act(async () => {
    document
      .querySelectorAll<HTMLInputElement>('input[value="unable_to_judge"]')
      .forEach((input) => input.click());
  });
}
async function send() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function typeComment(text: string) {
  await act(async () => {
    const textarea = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("required interview check-in", () => {
  it("blocks incomplete responses, accepts all unable, and requires no sharing or comment", async () => {
    await act(async () => root.render(<InterviewCheckIn sessionId="one" />));
    expect(submit().disabled).toBe(true);
    expect(document.body.textContent).toContain(
      "Your responses are saved to your account for product improvement.",
    );
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    expect(
      document.querySelectorAll('input[value="report_not_read"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('input[value="report_unavailable"]'),
    ).toHaveLength(1);
    await send();
    expect(api.saveInterviewFeedback).not.toHaveBeenCalled();
    await chooseUnable();
    expect(submit().disabled).toBe(false);
    await send();
    expect(api.saveInterviewFeedback).toHaveBeenCalledWith("one", {
      version: "post-interview-v1",
      answers: allUnable,
      comment: "",
      share_transcript: false,
    });
    expect(document.body.textContent).toContain(
      "Check-in saved to your account",
    );
    expect(document.querySelector("form")).toBeNull();
  });
  it("keeps unsaved selections across report arrival and save failure, then retries", async () => {
    vi.mocked(api.saveInterviewFeedback).mockRejectedValueOnce(
      new Error("Temporary outage"),
    );
    await act(async () =>
      root.render(<InterviewCheckIn key="one" sessionId="one" />),
    );
    await chooseUnable();
    await act(async () =>
      root.render(
        <InterviewCheckIn key="one" sessionId="one" reportAvailable />,
      ),
    );
    expect(api.getInterviewFeedback).toHaveBeenCalledOnce();
    expect(document.querySelectorAll("input:checked")).toHaveLength(6);
    await send();
    expect(document.body.textContent).toContain("Your unsaved answers remain");
    expect(document.querySelectorAll("input:checked")).toHaveLength(6);
    expect(submit().disabled).toBe(false);
    await send();
    expect(api.saveInterviewFeedback).toHaveBeenCalledTimes(2);
  });
  it("counts Unicode characters without truncating comments and preserves failed saves", async () => {
    vi.mocked(api.saveInterviewFeedback).mockRejectedValueOnce(
      new Error("Save unavailable"),
    );
    await act(async () => root.render(<InterviewCheckIn sessionId="one" />));
    await chooseUnable();
    await typeComment("🙂".repeat(2000));
    expect(submit().disabled).toBe(false);
    expect(document.querySelector("textarea")!.value).toHaveLength(4000);
    await typeComment("🙂".repeat(2001));
    expect(submit().disabled).toBe(true);
    expect(document.querySelector("textarea")!.value).toHaveLength(4002);
    expect(document.body.textContent).toContain(
      "Shorten your optional comment",
    );
    await typeComment("Keep this suggestion after a failed save");
    await send();
    expect(document.querySelector("textarea")!.value).toBe(
      "Keep this suggestion after a failed save",
    );
  });
  it("refreshes an ending interview until eligible without remounting its report", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.getInterviewFeedback).mockResolvedValueOnce({
        ...envelope(),
        required: false,
        eligible: false,
        session_status: "ending",
        feedback_version: "post-interview-v1",
      });
      await act(async () =>
        root.render(<InterviewCheckIn sessionId="one" reportAvailable />),
      );
      expect(document.querySelector("form")).toBeNull();
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(document.querySelector("form")).not.toBeNull();
      expect(api.getInterviewFeedback).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores stale pending status after a newer refresh confirms the check-in saved", async () => {
    let initial!: (
      v: Awaited<ReturnType<typeof api.getRequiredFeedback>>,
    ) => void;
    vi.mocked(api.getRequiredFeedback)
      .mockReturnValueOnce(
        new Promise((r) => {
          initial = r;
        }),
      )
      .mockResolvedValueOnce({ items: [], total: 0 });
    function Pending() {
      const { pending } = useRequiredFeedback(true);
      return <span>{pending?.total ?? "loading"}</span>;
    }
    await act(async () => root.render(<Pending />));
    await act(async () => feedbackChanged());
    expect(document.body.textContent).toBe("0");
    await act(async () => initial({ total: 1, items: [] }));
    expect(document.body.textContent).toBe("0");
  });
  it("prevents duplicate concurrent submissions", async () => {
    let resolve!: (v: InterviewFeedbackEnvelope) => void;
    vi.mocked(api.saveInterviewFeedback).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    await act(async () => root.render(<InterviewCheckIn sessionId="one" />));
    await chooseUnable();
    await act(async () => {
      const form = document.querySelector("form")!;
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(api.saveInterviewFeedback).toHaveBeenCalledOnce();
    await act(async () => resolve(saved()));
  });
  it("loads persisted answers for optional editing, while a new session cannot inherit them", async () => {
    vi.mocked(api.getInterviewFeedback).mockResolvedValueOnce(saved());
    await act(async () =>
      root.render(<InterviewCheckIn key="one" sessionId="one" />),
    );
    expect(document.body.textContent).toContain("Editing it is optional");
    expect(document.querySelector("form")).toBeNull();
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Edit responses"))!
        .click(),
    );
    expect(document.querySelectorAll("input:checked")).toHaveLength(6);
    await act(async () =>
      root.render(<InterviewCheckIn key="two" sessionId="two" />),
    );
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    expect(submit().disabled).toBe(true);
  });
  it("shows pending setup recovery while preserving selected options and keeping start disabled", async () => {
    vi.mocked(api.getQuestion).mockResolvedValue({
      id: "synthetic-question",
      title: "Synthetic scenario",
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
    vi.mocked(api.getUsage).mockResolvedValue({
      funded_available: true,
      local_unlimited: true,
    });
    vi.mocked(api.getResume).mockResolvedValue(null);
    vi.mocked(api.getRequiredFeedback).mockResolvedValue({
      total: 1,
      items: [
        {
          session_id: "previous",
          question_title: "Previous interview",
          status: "expired",
          version: "post-interview-v1",
          created_at: "2026-09-10T00:00:00Z",
        },
      ],
    });
    await act(async () => root.render(<SetupPage />));
    const check = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Check devices"),
    )!;
    expect(check.disabled).toBe(true);
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href^="/feedback?s=previous"]',
    )!;
    expect(link.href).toContain("next=%2Fsetup");
    link.addEventListener("click", (event) => event.preventDefault());
    await act(async () =>
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
        }),
      ),
    );
    const draft = JSON.parse(
      sessionStorage.getItem("mi_setup_draft_synthetic-question")!,
    );
    expect(draft.minutes).toBe(15);
    expect(draft.config.target_level).toBe("senior");
    expect(api.createSession).not.toHaveBeenCalled();
  });
});
describe("administrator aggregates", () => {
  it("does not request aggregates for a non-administrator", async () => {
    await act(async () => root.render(<FeedbackMetricsPage />));
    expect(document.body.textContent).toContain(
      "Administrator access required",
    );
    expect(api.getInterviewFeedbackMetrics).not.toHaveBeenCalled();
    expect(api.getFeedbackSuggestions).not.toHaveBeenCalled();
  });
  it("renders missing numeric ratings as unrated, with real response denominators", async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: "synthetic-admin",
      email: "admin@example.test",
      role: "admin",
    });
    vi.mocked(api.getInterviewFeedbackMetrics).mockResolvedValue(metrics);
    await act(async () => root.render(<FeedbackMetricsPage />));
    expect(api.getInterviewFeedbackMetrics).toHaveBeenCalledWith(30, "subject");
    expect(document.body.textContent).toContain("50.0%");
    expect(document.body.textContent).toContain("Not rated");
    expect(document.body.textContent).toContain("Unable to judge: 1");
    expect(document.body.textContent).not.toContain("0.00");
    expect(
      document.querySelector('[aria-label^="Optional tool comparison"]'),
    ).toBeNull();
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "Download comparison CSV",
      ),
    ).toBe(false);
  });
  it("shows optional comparison aggregates and their separate export only when returned", async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: "synthetic-admin",
      email: "admin@example.test",
      role: "admin",
    });
    const comparison = {
      instrument_version: "tool-comparison-v1" as const,
      answered_count: 1,
      skipped_count: 0,
      prior_use: { yes: 1, no: 0, prefer_not_to_say: 0 },
      preference: {
        mockinterview_better: 1,
        about_same: 0,
        other_tools_better: 0,
        unable_to_judge: 0,
      },
      compared_count: 1,
      other_tools_better_rate: 0,
    };
    vi.mocked(api.getInterviewFeedbackMetrics).mockResolvedValue({
      ...metrics,
      comparison,
      groups: metrics.groups.map((g) => ({ ...g, comparison })),
    });
    await act(async () => root.render(<FeedbackMetricsPage />));
    expect(
      document.querySelectorAll('[aria-label^="Optional tool comparison"]'),
    ).toHaveLength(2);
    expect(document.body.textContent).toContain("0 / 1 · 0%");
    expect(document.body.textContent).toContain("including older responses");
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (b) => b.textContent === "Download comparison CSV",
      ),
    ).toBe(true);
  });
  it("shows no attempts rather than zero response rate when the eligible cohort is empty", async () => {
    vi.mocked(api.me).mockResolvedValue({
      id: "synthetic-admin",
      email: "admin@example.test",
      role: "admin",
    });
    vi.mocked(api.getInterviewFeedbackMetrics).mockResolvedValue({
      ...metrics,
      totals: {
        eligible_sessions: 0,
        responded_sessions: 0,
        pending_sessions: 0,
        response_rate: null,
      },
      groups: [],
    });
    await act(async () => root.render(<FeedbackMetricsPage />));
    expect(document.body.textContent).toContain("No attempts");
    expect(document.body.textContent).not.toContain("0.0%");
  });
  it("keeps private suggestions while paging fails, retries the cursor and deduplicates", async () => {
    const item = {
      session_id: "synthetic-session",
      version: "post-interview-v1",
      question_title: "Scenario",
      subject_key: "subject",
      subject_label: "Subject",
      mode: "text",
      provider: "stub",
      status: "complete",
      comment: "Make setup clearer <script>unsafe()</script>",
      share_transcript: false,
      submitted_at: "2026-09-10T00:00:00Z",
      updated_at: "2026-09-10T00:00:00Z",
    };
    vi.mocked(api.getFeedbackSuggestions)
      .mockResolvedValueOnce({ items: [item], next_cursor: "opaque cursor" })
      .mockRejectedValueOnce(new Error("Temporary outage"))
      .mockResolvedValueOnce({
        items: [
          item,
          { ...item, session_id: "second", comment: "Second suggestion" },
        ],
        next_cursor: null,
      });
    await act(async () => root.render(<AdminFeedbackSuggestions />));
    expect(document.querySelector("script")).toBeNull();
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent?.includes("Load more"))!
        .click(),
    );
    expect(document.body.textContent).toContain(item.comment);
    await act(async () =>
      Array.from(document.querySelectorAll("button"))
        .find((b) => b.textContent === "Try again")!
        .click(),
    );
    expect(api.getFeedbackSuggestions).toHaveBeenNthCalledWith(
      3,
      "opaque cursor",
    );
    expect(document.body.textContent?.split(item.comment)).toHaveLength(2);
    expect(document.body.textContent).toContain("Second suggestion");
  });
  it("keeps cohort context in an empty export", () => {
    const csv = metricsCSV({
      ...metrics,
      groups: [],
      totals: {
        eligible_sessions: 0,
        responded_sessions: 0,
        pending_sessions: 0,
        response_rate: null,
      },
    });
    const [header, row] = csv.split("\r\n");
    expect(row).toMatch(
      /^"post-interview-v1","30","2026-09-10T00:00:00Z","subject","","","0","0","0","",/,
    );
    expect(row.split(",")).toHaveLength(header.split(",").length);
  });
  it("exports unrated means/rates as empty and neutralizes spreadsheet formula labels", () => {
    const csv = metricsCSV(metrics);
    const [header, ...rows] = csv.split("\r\n");
    expect(header).toMatch(
      /^"schema_version","days","generated_at","group_by",/,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows)
      expect(row).toMatch(
        /^"post-interview-v1","30","2026-09-10T00:00:00Z","subject",/,
      );
    expect(csv).toContain('"\'=UNTRUSTED()"');
    expect(csv).toContain('"unable_to_judge","1","0","1","","0","4 or 5",""');
    expect(csv).not.toContain('"0.00"');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InterviewFeedbackDialog } from "../components/InterviewFeedbackDialog";
import { api } from "./api";
import type { InterviewFeedbackEnvelope } from "./features/feedback";

vi.mock("./api", () => ({
  IS_MOCK: false,
  api: { getInterviewFeedback: vi.fn(), saveInterviewFeedback: vi.fn() },
}));
vi.mock("./desktop", () => ({ IS_DESKTOP: false }));
vi.mock("../components/InterviewFeedbackDialog.module.css", () => ({
  default: new Proxy({}, { get: (_target, key) => String(key) }),
}));

const questionIDs = [
  "usability_ease",
  "interviewer_realism",
  "subject_probe_quality",
  "challenge_fit",
  "report_actionability",
  "disruption_severity",
];
const answers = Object.fromEntries(
  questionIDs.map((id) => [id, "unable_to_judge"]),
);
function pending(): InterviewFeedbackEnvelope {
  return {
    eligible: true,
    required: true,
    report_available: false,
    questionnaire: {
      version: "post-interview-v1",
      subject_key: "technical",
      subject_label: "Technical reasoning",
      questions: questionIDs.map((id) => ({
        id,
        prompt: id.replaceAll("_", " "),
        options: [{ value: "unable_to_judge", label: "Unable to judge" }],
      })),
    },
    response: null,
  };
}
function saved(): InterviewFeedbackEnvelope {
  return {
    ...pending(),
    required: false,
    response: {
      version: "post-interview-v1",
      answers,
      comment: "",
      share_transcript: false,
      submitted_at: "2026-10-05T00:00:00Z",
      updated_at: "2026-10-05T00:00:00Z",
    },
  };
}
let root: Root;
const originalShowModal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const originalClose = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="feedback-dialog-test"></div>';
  root = createRoot(document.querySelector("#feedback-dialog-test")!);
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = true;
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      },
    },
  });
  vi.mocked(api.getInterviewFeedback).mockResolvedValue(pending());
  vi.mocked(api.saveInterviewFeedback).mockResolvedValue(saved());
});
afterEach(async () => {
  await act(async () => root.unmount());
  for (const [name, descriptor] of [
    ["showModal", originalShowModal],
    ["close", originalClose],
  ] as const) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  window.history.replaceState({}, "", "/");
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
const trigger = () =>
  document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const dialog = () => document.querySelector<HTMLDialogElement>("dialog")!;
async function render(reportAvailable = false) {
  await act(async () =>
    root.render(
      <InterviewFeedbackDialog
        sessionId="one"
        reportAvailable={reportAvailable}
      />,
    ),
  );
}
async function open() {
  await act(async () => {
    trigger().focus();
    trigger().click();
  });
  expect(dialog().open).toBe(true);
}
async function close() {
  await act(async () => {
    const button = dialog().querySelector<HTMLButtonElement>(
      'button[aria-label="Close interview feedback"]',
    )!;
    button.focus();
    button.click();
  });
  expect(dialog().open).toBe(false);
}
async function fill(comment = "") {
  await act(async () => {
    dialog()
      .querySelectorAll<HTMLInputElement>('input[value="unable_to_judge"]')
      .forEach((input) => input.click());
  });
  if (comment)
    await act(async () => {
      const textarea = dialog().querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(textarea, comment);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
}
async function submit() {
  await act(async () => {
    dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
    dialog()
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

describe("interview feedback popup", () => {
  it("keeps loading and load errors neutral, then retries to the pending state", async () => {
    let fail!: (error: Error) => void;
    vi.mocked(api.getInterviewFeedback).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    );
    await render();
    expect(trigger().dataset.status).toBe("loading");
    expect(trigger().textContent).toContain("Loading…");
    expect(trigger().textContent).not.toContain("Pending");
    expect(trigger().textContent).not.toContain("Submitted");
    expect(dialog().open).toBe(false);
    await open();
    expect(dialog().querySelector("form")).toBeNull();
    await act(async () => fail(new Error("Cannot load feedback")));
    expect(trigger().dataset.status).toBe("unavailable");
    expect(trigger().textContent).toContain("Unavailable");
    expect(trigger().textContent).not.toContain("Pending");
    expect(trigger().textContent).not.toContain("Submitted");
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(
      "Cannot load feedback",
    );
    await act(async () =>
      Array.from(dialog().querySelectorAll("button"))
        .find((button) => button.textContent?.trim() === "Try again")!
        .click(),
    );
    expect(api.getInterviewFeedback).toHaveBeenCalledTimes(2);
    expect(trigger().dataset.status).toBe("pending");
    expect(dialog().querySelector("form")).not.toBeNull();
    expect(dialog().open).toBe(true);
  });

  it("shows Not available for an ineligible interview without claiming a submission is pending", async () => {
    vi.mocked(api.getInterviewFeedback).mockResolvedValue({
      ...pending(),
      eligible: false,
      required: false,
    });
    await render();
    expect(trigger().dataset.status).toBe("ineligible");
    expect(trigger().textContent).toContain("Not available");
    expect(trigger().textContent).not.toContain("Pending");
    expect(trigger().textContent).not.toContain("Submitted");
    await open();
    expect(dialog().querySelector("form")).toBeNull();
    expect(dialog().textContent).toContain(
      "No check-in is required for this interview",
    );
    expect(api.saveInterviewFeedback).not.toHaveBeenCalled();
  });

  it("loads persisted submitted status while closed and gives the dialog an accessible name", async () => {
    vi.mocked(api.getInterviewFeedback).mockResolvedValue(saved());
    await render(true);
    expect(trigger().dataset.status).toBe("submitted");
    expect(trigger().textContent).toContain("Interview feedback");
    expect(trigger().textContent).toContain("Submitted");
    expect(dialog().open).toBe(false);
    const labelledBy = dialog().getAttribute("aria-labelledby")!;
    expect(document.getElementById(labelledBy)?.textContent).toBe(
      "Interview feedback",
    );
    await open();
    expect(dialog().querySelector("form")).toBeNull();
    expect(dialog().querySelector("details.check-in-details")).toBeNull();
    expect(dialog().textContent).toContain("Edit responses (optional)");
    await close();
    expect(document.activeElement).toBe(trigger());
  });

  it("stays pending during submission and becomes submitted only after server confirmation", async () => {
    let confirm!: (value: InterviewFeedbackEnvelope) => void;
    vi.mocked(api.saveInterviewFeedback).mockReturnValueOnce(
      new Promise((resolve) => {
        confirm = resolve;
      }),
    );
    await render();
    expect(trigger().dataset.status).toBe("pending");
    await open();
    await fill();
    await submit();
    expect(api.saveInterviewFeedback).toHaveBeenCalledWith("one", {
      version: "post-interview-v1",
      answers,
      comment: "",
      share_transcript: false,
    });
    expect(trigger().dataset.status).toBe("pending");
    expect(
      dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!
        .disabled,
    ).toBe(true);
    await act(async () => confirm(saved()));
    expect(trigger().dataset.status).toBe("submitted");
    expect(trigger().textContent).toContain("Submitted");
    expect(dialog().querySelector("form")).toBeNull();
    const confirmation =
      dialog().querySelector<HTMLParagraphElement>('p[role="status"]')!;
    expect(confirmation.textContent).toContain(
      "Check-in saved to your account",
    );
    expect(document.activeElement).toBe(confirmation);

    await act(async () =>
      Array.from(dialog().querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Edit responses"))!
        .click(),
    );
    await fill("An updated suggestion");
    const updated = saved();
    updated.response!.comment = "An updated suggestion";
    vi.mocked(api.saveInterviewFeedback).mockResolvedValueOnce(updated);
    expect(trigger().dataset.status).toBe("submitted");
    await submit();
    expect(api.saveInterviewFeedback).toHaveBeenCalledTimes(2);
    const editedConfirmation =
      dialog().querySelector<HTMLParagraphElement>('p[role="status"]')!;
    expect(editedConfirmation).not.toBe(confirmation);
    expect(editedConfirmation.textContent).toContain(
      "Check-in saved to your account",
    );
    expect(document.activeElement).toBe(editedConfirmation);
    expect(dialog().open).toBe(true);
  });

  it.each(["save failure", "unconfirmed response"])(
    "keeps the pending status and draft after %s",
    async (failure) => {
      if (failure === "save failure")
        vi.mocked(api.saveInterviewFeedback).mockRejectedValueOnce(
          new Error("Temporary outage"),
        );
      else
        vi.mocked(api.saveInterviewFeedback).mockResolvedValueOnce(pending());
      await render();
      await open();
      await fill("Keep this feedback draft");
      await submit();
      expect(trigger().dataset.status).toBe("pending");
      expect(dialog().querySelector("textarea")!.value).toBe(
        "Keep this feedback draft",
      );
      expect(
        dialog().querySelectorAll('input[type="radio"]:checked'),
      ).toHaveLength(6);
      expect(dialog().textContent).toContain("Your unsaved answers remain");
      await close();
      await open();
      expect(dialog().querySelector("textarea")!.value).toBe(
        "Keep this feedback draft",
      );
      expect(api.getInterviewFeedback).toHaveBeenCalledOnce();
    },
  );

  it("preserves drafts across closing, reopening, and report arrival without refetching or opening automatically", async () => {
    await render();
    await open();
    await fill("My suggestion stays here");
    await close();
    await render(true);
    expect(dialog().open).toBe(false);
    expect(api.getInterviewFeedback).toHaveBeenCalledOnce();
    await open();
    expect(dialog().querySelector("textarea")!.value).toBe(
      "My suggestion stays here",
    );
    expect(
      dialog().querySelectorAll('input[type="radio"]:checked'),
    ).toHaveLength(6);
    expect(api.getInterviewFeedback).toHaveBeenCalledOnce();
  });

  it("closes the popup when navigating to the report on the same page", async () => {
    await render(true);
    await open();
    const link = dialog().querySelector<HTMLAnchorElement>(
      'a[href="#report-summary"]',
    )!;
    expect(link.textContent).toContain("Read your report");
    await act(async () => link.click());
    expect(dialog().open).toBe(false);
  });

  it("does not mistake an optional unsaved response for a submitted response", async () => {
    vi.mocked(api.getInterviewFeedback).mockResolvedValue({
      ...pending(),
      required: false,
    });
    await render();
    expect(trigger().dataset.status).toBe("pending");
    expect(trigger().textContent).not.toContain("Submitted");
  });
});

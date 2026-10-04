import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppShell } from "../components/AppShell";
import { FeedbackWidget } from "../components/FeedbackWidget";
import { api } from "./api";

const environment = vi.hoisted(() => ({ mockMode: false }));
vi.mock("./api", () => ({
  get IS_MOCK() {
    return environment.mockMode;
  },
  api: { me: vi.fn(), logout: vi.fn(), sendFeedback: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

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
  environment.mockMode = false;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  document.body.innerHTML = '<div id="feedback-test"></div>';
  root = createRoot(document.querySelector("#feedback-test")!);
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
  vi.mocked(api.me).mockResolvedValue({
    id: "synthetic-user",
    email: "synthetic@example.test",
    email_verified: true,
    role: "user",
  });
  vi.mocked(api.sendFeedback).mockResolvedValue({ id: "feedback-123" });
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const [name, descriptor] of [
    ["showModal", originalShowModal],
    ["close", originalClose],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    } else {
      Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
  }
  window.history.replaceState({}, "", "/");
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function button(text: string) {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).find((node) => node.textContent?.trim() === text)!;
}

function field<T extends HTMLElement>(label: string): T {
  return Array.from(document.querySelectorAll("label")).find((node) =>
    node.textContent?.includes(label),
  )!.control as T;
}

async function render(props: ComponentProps<typeof FeedbackWidget> = {}) {
  await act(async () => root.render(<FeedbackWidget {...props} />));
  await act(async () =>
    button(
      props.label ??
        (props.variant === "studio" ? "Report a problem" : "Share feedback"),
    ).click(),
  );
  expect(document.querySelector("dialog")?.open).toBe(true);
}

async function choose(label: string, value: string) {
  await act(async () => {
    const select = field<HTMLSelectElement>(label);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function writeMessage(value: string) {
  await act(async () => {
    const textarea = document.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function check(label: string) {
  await act(async () => field<HTMLInputElement>(label).click());
}

async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}

async function reopen(trigger = "Share feedback") {
  await act(async () =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Close feedback"]')!
      .click(),
  );
  expect(document.querySelector("dialog")?.open).toBe(false);
  await act(async () => button(trigger).click());
}

describe("feedback access", () => {
  it("places one feedback button before Practice in the signed-in header", async () => {
    await act(async () =>
      root.render(<AppShell active="dashboard">Practice content</AppShell>),
    );
    const buttons = Array.from(document.querySelectorAll("button")).filter(
      (node) => node.textContent?.trim() === "Share feedback",
    );
    expect(buttons).toHaveLength(1);
    const feedback = buttons[0];
    expect(feedback.closest("header")).not.toBeNull();
    const practice = document.querySelector('header a[href="/interviews"]')!;
    expect(
      feedback.compareDocumentPosition(practice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("footer")?.textContent).not.toContain(
      "Share feedback",
    );
    await act(async () => feedback.click());
    expect(document.querySelector("dialog")?.open).toBe(true);
  });

  it("does not offer authenticated feedback to signed-out visitors", async () => {
    vi.mocked(api.me).mockResolvedValue(null);
    await act(async () =>
      root.render(<AppShell active="public">Welcome</AppShell>),
    );
    expect(button("Share feedback")).toBeUndefined();
  });

  it.each([
    "/report?s=synthetic-session&token=private",
    "/feedback/?s=synthetic-session",
    "/interviews?s=unrelated",
  ])(
    "captures the page and section without trusting query IDs for %s",
    async (url) => {
      window.history.replaceState({}, "", url);
      await act(async () =>
        root.render(<AppShell active="results">Report content</AppShell>),
      );
      await act(async () => button("Share feedback").click());
      await writeMessage("This page needs a clearer explanation.");
      await check("Include page and connection diagnostics");
      await submit();
      expect(api.sendFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: undefined,
          tags: ["source:header"],
          context: expect.objectContaining({
            page: window.location.pathname,
            section: "results",
          }),
        }),
      );
    },
  );

  it("links a validated header session and offers independent transcript consent", async () => {
    window.history.replaceState({}, "", "/report?s=ignored-query-id");
    await act(async () =>
      root.render(
        <AppShell active="results" feedbackSessionId="validated-session">
          Report content
        </AppShell>,
      ),
    );
    await act(async () => button("Share feedback").click());
    await writeMessage("Please inspect this report's interrupted interview.");
    expect(
      field<HTMLInputElement>("Allow maintainers to inspect").checked,
    ).toBe(false);
    await check("Allow maintainers to inspect");
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        session_id: "validated-session",
        tags: ["source:header"],
        include_diagnostics: false,
        share_transcript: true,
        context: {},
      }),
    );
    expect(document.body.textContent).toContain("Reference: feedback-123");
  });

  it("saves general feedback from a stale report link without attaching its deleted session", async () => {
    window.history.replaceState({}, "", "/report?s=deleted-session");
    vi.mocked(api.sendFeedback).mockImplementation(async (payload) => {
      if (payload.session_id)
        throw new Error("Feedback must refer to your own interview");
      return { id: "broken-report-feedback" };
    });
    await act(async () =>
      root.render(<AppShell active="results">Interview not found</AppShell>),
    );
    await act(async () => button("Share feedback").click());
    await writeMessage("My bookmarked report no longer opens.");
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "product",
        message: "My bookmarked report no longer opens.",
        session_id: undefined,
      }),
    );
    expect(document.body.textContent).toContain(
      "Reference: broken-report-feedback",
    );
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
});

describe("feedback capture", () => {
  it("clearly labels demo submissions as unsaved without sending feedback", async () => {
    environment.mockMode = true;
    await render();
    await writeMessage("Synthetic demo feedback.");
    await submit();
    expect(api.sendFeedback).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "This is demo mode. No feedback was sent or stored.",
    );
    expect(document.body.textContent).not.toContain("Reference:");
  });

  it("saves category, rating, message, and header source with sharing off by default", async () => {
    const getContext = vi.fn(() => ({
      session_id: "private-session",
      connection: "ready",
    }));
    await render({ getContext });
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    await choose("What is your feedback about?", "report");
    await choose("Rating", "4");
    await writeMessage("  Please explain the score more clearly.  ");
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledExactlyOnceWith({
      kind: "report",
      message: "Please explain the score more clearly.",
      rating: 4,
      tags: ["source:header"],
      include_diagnostics: false,
      share_transcript: false,
      session_id: "private-session",
      context: undefined,
    });
    expect(getContext).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Reference: feedback-123");
    expect(document.querySelector("form")).toBeNull();
  });

  it("collects consented diagnostics without query strings, fragments, or unapproved context", async () => {
    window.history.replaceState(
      {},
      "",
      "/interview?token=private#private-fragment",
    );
    const getContext = vi.fn(() => ({
      session_id: "synthetic-session",
      connection: "ready",
      mode: "text",
      section: "Introduction",
      secret: "private-value",
      transcript_tail: [{ role: "candidate", text: "Private transcript" }],
    }));
    await render({ variant: "studio", getContext });
    await writeMessage("The connection indicator was confusing.");
    await check("Include page and connection diagnostics");
    await submit();
    const payload = vi.mocked(api.sendFeedback).mock.calls[0][0];
    expect(payload).toMatchObject({
      kind: "interview",
      tags: ["source:interview-room"],
      include_diagnostics: true,
      share_transcript: false,
      session_id: "synthetic-session",
      context: {
        page: "/interview",
        connection: "ready",
        mode: "text",
        section: "Introduction",
        browser: expect.any(String),
        viewport: expect.any(String),
        language: navigator.language,
        timezone: expect.any(String),
        online: navigator.onLine ? "online" : "offline",
      },
    });
    expect(payload.context).not.toHaveProperty("secret");
    expect(payload.context).not.toHaveProperty("transcript_tail");
    expect(JSON.stringify(payload.context)).not.toContain("private");
  });

  it.each(["explicit session", "studio context"])(
    "allows transcript consent independently of diagnostics using an %s",
    async (source) => {
      const getContext = vi.fn(() => ({
        session_id: "synthetic-session",
        connection: "ready",
        transcript_tail: [{ role: "candidate", text: "Consented transcript" }],
      }));
      await render(
        source === "explicit session"
          ? { sessionId: "synthetic-session" }
          : { variant: "studio", getContext },
      );
      await writeMessage("Please review the interruption.");
      await check("Allow maintainers to inspect");
      await submit();
      expect(api.sendFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: "synthetic-session",
          include_diagnostics: false,
          share_transcript: true,
          context:
            source === "explicit session"
              ? {}
              : {
                  transcript_tail: [
                    { role: "candidate", text: "Consented transcript" },
                  ],
                },
        }),
      );
    },
  );

  it("links the interview while omitting diagnostic context without consent", async () => {
    const getContext = vi.fn(() => ({
      session_id: "private-session",
      mode: "text",
    }));
    await render({
      variant: "studio",
      sessionId: "private-session",
      getContext,
    });
    await choose("Rating", "3");
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        tags: ["source:interview-room"],
        session_id: "private-session",
        context: undefined,
        include_diagnostics: false,
        share_transcript: false,
      }),
    );
    expect(getContext).toHaveBeenCalledOnce();
  });

  it("rejects an empty submission even when a submit event bypasses the disabled button", async () => {
    await render();
    expect(button("Send feedback").disabled).toBe(true);
    await submit();
    expect(api.sendFeedback).not.toHaveBeenCalled();
  });

  it("prevents two submit events in the same tick from saving twice", async () => {
    let resolve!: (value: { id: string }) => void;
    vi.mocked(api.sendFeedback).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render();
    await writeMessage("One feedback report.");
    await act(async () => {
      const form = document.querySelector("form")!;
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(api.sendFeedback).toHaveBeenCalledOnce();
    expect(button("Sending…").disabled).toBe(true);
    await act(async () => resolve({ id: "single-report" }));
    expect(document.body.textContent).toContain("Reference: single-report");
  });

  it("keeps the complete draft and consent choices after a failed save and reopening", async () => {
    vi.mocked(api.sendFeedback).mockRejectedValueOnce(
      new Error("Save unavailable"),
    );
    await render({ sessionId: "synthetic-session" });
    await choose("What is your feedback about?", "question");
    await choose("Rating", "2");
    await writeMessage("The question has two plausible interpretations.");
    await check("Include page and connection diagnostics");
    await check("Allow maintainers to inspect");
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Save unavailable",
    );
    expect(document.querySelector("textarea")?.value).toBe(
      "The question has two plausible interpretations.",
    );
    await reopen();
    expect(field<HTMLSelectElement>("What is your feedback about?").value).toBe(
      "question",
    );
    expect(field<HTMLSelectElement>("Rating").value).toBe("2");
    expect(document.querySelector("textarea")?.value).toBe(
      "The question has two plausible interpretations.",
    );
    expect(document.querySelectorAll("input:checked")).toHaveLength(2);
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("Reference: feedback-123");
  });

  it.each(["", "   "])(
    "does not confirm a save without a nonempty server reference (%j)",
    async (id) => {
      vi.mocked(api.sendFeedback).mockResolvedValueOnce({ id });
      await render();
      await writeMessage("Keep this draft until the server confirms capture.");
      await submit();
      expect(document.querySelector('[role="alert"]')).not.toBeNull();
      expect(document.body.textContent).not.toContain(
        "Your feedback has been saved",
      );
      expect(document.querySelector("textarea")?.value).toBe(
        "Keep this draft until the server confirms capture.",
      );
    },
  );

  it("accepts 5000 Unicode code points and preserves an over-limit draft without truncation", async () => {
    await render();
    const oversized = "🙂".repeat(5001);
    await writeMessage(oversized);
    expect(document.querySelector("textarea")?.value).toBe(oversized);
    expect(button("Send feedback").disabled).toBe(true);
    await submit();
    expect(api.sendFeedback).not.toHaveBeenCalled();
    const atLimit = "🙂".repeat(5000);
    await writeMessage(atLimit);
    expect(button("Send feedback").disabled).toBe(false);
    await submit();
    expect(api.sendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ message: atLimit }),
    );
  });

  it("starts a new feedback draft with fields and consents reset after a confirmed save", async () => {
    await render({ sessionId: "synthetic-session" });
    await choose("What is your feedback about?", "question");
    await choose("Rating", "5");
    await writeMessage("That explanation helped.");
    await check("Include page and connection diagnostics");
    await check("Allow maintainers to inspect");
    await submit();
    await reopen();
    expect(field<HTMLSelectElement>("What is your feedback about?").value).toBe(
      "product",
    );
    expect(field<HTMLSelectElement>("Rating").value).toBe("");
    expect(document.querySelector("textarea")?.value).toBe("");
    expect(document.querySelectorAll("input:checked")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Reference: feedback-123");
    expect(button("Send feedback").disabled).toBe(true);
  });
});

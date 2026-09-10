import { beforeEach, describe, expect, it } from "vitest";
import { readSetupDraft, writeSetupDraft, type SetupDraft } from "./setupDraft";
beforeEach(() => sessionStorage.clear());
describe("sign-in preserves non-secret interview choices", () => {
  it("keeps duration and interviewer options while omitting credentials and resume consent", () => {
    const draft = {
      minutes: 8,
      mode: "text",
      funding: "byok",
      provider: "openai",
      model: "test-model",
      api_key: "top-secret",
      config: {
        target_level: "senior",
        challenge: "stretch",
        face_id: "sam",
        include_resume: true,
        api_key: "nested-secret",
      },
    } as unknown as SetupDraft;
    writeSetupDraft("mi_setup_draft_question", draft);
    expect(sessionStorage.getItem("mi_setup_draft_question")).not.toMatch(
      /secret|api_key|include_resume/,
    );
    expect(readSetupDraft("mi_setup_draft_question")).toMatchObject({
      minutes: 8,
      config: { target_level: "senior", challenge: "stretch", face_id: "sam" },
    });
    // React Strict Mode may read twice before the surviving effect applies it.
    expect(readSetupDraft("mi_setup_draft_question")?.minutes).toBe(8);
  });
  it("ignores corrupt or stale preferences", () => {
    sessionStorage.setItem("draft", "oops");
    expect(readSetupDraft("draft")).toBeNull();
    sessionStorage.setItem(
      "draft",
      JSON.stringify({ expires: 1, minutes: 30, config: {} }),
    );
    expect(readSetupDraft("draft")).toBeNull();
  });
});

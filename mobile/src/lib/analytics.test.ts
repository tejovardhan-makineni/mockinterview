import test from "node:test";
import assert from "node:assert/strict";
import {
  mobileAnalyticsPayload,
  setMobileSharing,
  shareMobileResult,
} from "./analytics";
import type { PracticeSession } from "./domain";
const session: PracticeSession = {
  id: "practice-1",
  topicId: "career",
  startedAt: "2026-10-04T10:00:00Z",
  completedAt: "2026-10-04T10:02:00Z",
  questionIds: ["career-introduction"],
  answers: [
    {
      questionId: "career-introduction",
      text: "My answer",
      checked: [],
      recordingUri: "file://private-recording.wav",
      durationSeconds: 20,
    },
  ],
  reflection: "Be specific",
};
test("shared practice results exclude recordings and distinguish self-review from AI scoring", () => {
  const data = mobileAnalyticsPayload(session);
  assert.equal(data.duration_seconds, 120);
  assert.equal(data.report.scored, false);
  assert.equal(data.provider, "self-review");
  assert.ok(!data.report.coaching_md.includes("My answer"));
  assert.ok(!JSON.stringify(data).includes("recording"));
});
test("disabled sharing never calls the network", async () => {
  setMobileSharing(false);
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    throw Error("unexpected");
  };
  try {
    assert.equal(await shareMobileResult(session), false);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

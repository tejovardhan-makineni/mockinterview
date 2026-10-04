/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import {
  createSession,
  getQuestion,
  MAX_SAVED_SESSIONS,
  parsePracticeSession,
  questions,
  selectQuestions,
  sessionProgress,
  topics,
  type PracticeSession,
} from "./domain";
import {
  createPracticeStore,
  storageKeys,
  type KeyValueStorage,
} from "./storage-core";

class MemoryStorage implements KeyValueStorage {
  data = new Map<string, string>();
  failReads = new Set<string>();
  failWrites = new Set<string>();

  async getItem(key: string) {
    if (this.failReads.has(key)) throw new Error("Unavailable storage");
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string) {
    if (this.failWrites.has(key)) throw new Error("Storage is full");
    this.data.set(key, value);
  }

  async removeItem(key: string) {
    this.data.delete(key);
  }
  async getAllKeys() {
    return [...this.data.keys()];
  }
}

const encode = (value: unknown) => JSON.stringify({ version: 1, value });

function completedSession(index = 0): PracticeSession {
  const session = createSession("behavioral", 1);
  session.id = `saved-${index}`;
  session.startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
  session.completedAt = new Date(
    Date.UTC(2026, 0, 1, 0, index, 30),
  ).toISOString();
  session.answers[0].text = `An answer ${index}`;
  return session;
}

test("every topic has original, complete mobile prompts and selection rotates past recent questions", () => {
  assert.equal(questions.length, 12);
  assert.equal(new Set(questions.map((question) => question.id)).size, 12);
  for (const topic of topics) {
    const initial = selectQuestions(topic.id, 3);
    assert.equal(initial.length, 3);
    assert.ok(
      initial.every(
        (question) =>
          question.topicId === topic.id && question.checkpoints.length === 3,
      ),
    );
    const fresh = selectQuestions(
      topic.id,
      1,
      initial.map((question) => question.id),
    );
    assert.ok(!initial.some((question) => question.id === fresh[0].id));
    const allRecent = questions
      .filter((question) => question.topicId === topic.id)
      .map((question) => question.id);
    assert.equal(
      selectQuestions(topic.id, 1, allRecent)[0].id,
      allRecent.at(-1),
    );
  }
});

test("progress counts written and recorded answers without scoring their quality", () => {
  const session = createSession("career", 3);
  session.answers[0].text = "   ";
  session.answers[1].text = "My introduction";
  session.answers[2].recordingUri = "file:///practice/answer.m4a";
  const checkpoint = getQuestion(session.questionIds[1])!.checkpoints[0];
  session.answers[1].checked = [checkpoint, checkpoint, "Not a checkpoint"];
  assert.deepEqual(sessionProgress(session), {
    answered: 2,
    total: 3,
    checked: 1,
    totalCheckpoints: 9,
    percent: 67,
  });
});

test("session validation rejects unknown questions, cross-topic prompts and untrusted checklist values", () => {
  const original = createSession("technical", 1);
  assert.deepEqual(parsePracticeSession(original), original);
  assert.equal(
    parsePracticeSession({ ...original, questionIds: ["unknown-question"] }),
    null,
  );
  assert.equal(parsePracticeSession({ ...original, topicId: "career" }), null);
  assert.equal(
    parsePracticeSession({
      ...original,
      questionIds: [
        original.questionIds[0],
        original.questionIds[0],
        original.questionIds[0],
      ],
    }),
    null,
  );
  assert.equal(
    parsePracticeSession({
      ...original,
      answers: [{ ...original.answers[0], checked: ["Made up"] }],
    }),
    null,
  );
  assert.equal(
    parsePracticeSession({
      ...original,
      answers: [
        { ...original.answers[0], recordingUri: "https://example.com/audio" },
      ],
    }),
    null,
  );
  assert.equal(
    parsePracticeSession({
      ...original,
      answers: [{ ...original.answers[0], durationSeconds: Infinity }],
    }),
    null,
  );
});

test("drafts resume with answers, local recordings and self-review choices intact", async () => {
  const memory = new MemoryStorage();
  const firstStore = createPracticeStore(memory);
  const draft = createSession("technical", 3);
  draft.currentQuestionIndex = 1;
  draft.answers[0] = {
    ...draft.answers[0],
    text: "First I would clarify the problem.",
    recordingUri: "file:///practice/answer.m4a",
    durationSeconds: 42,
    checked: [getQuestion(draft.questionIds[0])!.checkpoints[0]],
  };
  await firstStore.saveDraft(draft);
  const reopened = await createPracticeStore(memory).getSavedState();
  assert.deepEqual(reopened.draft, draft);
  assert.deepEqual(reopened.storageWarnings, []);
});

test("draft question position is bounded and older drafts without a position stay compatible", () => {
  const draft = createSession("career", 3);
  assert.equal(
    parsePracticeSession({ ...draft, currentQuestionIndex: 99 })
      ?.currentQuestionIndex,
    2,
  );
  assert.equal(
    parsePracticeSession({ ...draft, currentQuestionIndex: -3 })
      ?.currentQuestionIndex,
    0,
  );
  assert.equal(
    parsePracticeSession({ ...draft, currentQuestionIndex: 1.5 })
      ?.currentQuestionIndex,
    1,
  );
  assert.equal(
    parsePracticeSession({ ...draft, currentQuestionIndex: Infinity }),
    null,
  );
  const legacyDraft = { ...draft };
  delete legacyDraft.currentQuestionIndex;
  assert.deepEqual(parsePracticeSession(legacyDraft), legacyDraft);
});

test("rapid bookmark updates and typing writes do not lose updates or share mutable caller data", async () => {
  const store = createPracticeStore(new MemoryStorage());
  const draft = createSession("career", 1);
  draft.answers[0].text = "First";
  const firstWrite = store.saveDraft(draft);
  draft.answers[0].text = "Second";
  const secondWrite = store.saveDraft(draft);
  draft.answers[0].text = "Never saved";
  await Promise.all([
    firstWrite,
    secondWrite,
    ...questions.map((question) => store.setBookmark(question.id, true)),
  ]);
  const state = await store.getSavedState();
  assert.equal(state.draft?.answers[0].text, "Second");
  assert.equal(state.bookmarks.length, 12);
  await Promise.all(
    questions
      .slice(0, 6)
      .map((question) => store.setBookmark(question.id, false)),
  );
  assert.equal((await store.getSavedState()).bookmarks.length, 6);
});

test("saved sessions are newest first, upserted once, capped, and only clear their own draft", async () => {
  const store = createPracticeStore(new MemoryStorage());
  const unrelatedDraft = createSession("career", 1);
  await store.saveDraft(unrelatedDraft);
  const pruned = await Promise.all(
    Array.from({ length: MAX_SAVED_SESSIONS + 2 }, (_, index) =>
      store.saveSession(completedSession(index)),
    ),
  );
  assert.deepEqual(
    pruned.flat().map((session) => session.id),
    ["saved-0", "saved-1"],
  );
  let state = await store.getSavedState();
  assert.equal(state.sessions.length, MAX_SAVED_SESSIONS);
  assert.equal(state.sessions[0].id, "saved-31");
  assert.equal(state.sessions.at(-1)?.id, "saved-2");
  assert.equal(state.draft?.id, unrelatedDraft.id);
  const revised = {
    ...state.sessions[0],
    reflection: "Keep the opening shorter.",
  };
  await store.saveSession(revised);
  assert.equal(
    (await store.getSavedState()).sessions.filter(
      (session) => session.id === revised.id,
    ).length,
    1,
  );
  const completeDraft = {
    ...unrelatedDraft,
    completedAt: new Date().toISOString(),
  };
  await store.saveSession(completeDraft);
  state = await store.getSavedState();
  assert.equal(state.draft, null);
  assert.ok(state.sessions.some((session) => session.id === completeDraft.id));
});

test("corrupted records do not hide good sessions and are backed up before repair", async () => {
  const memory = new MemoryStorage();
  const good = completedSession();
  const corruptHistory = encode([good, { broken: true }]);
  memory.data.set(storageKeys.sessions, corruptHistory);
  memory.data.set(storageKeys.draft, "{bad json");
  memory.data.set(
    storageKeys.bookmarks,
    encode([questions[0].id, "unknown-id"]),
  );
  const store = createPracticeStore(memory);
  const state = await store.getSavedState();
  assert.deepEqual(state.sessions, [good]);
  assert.deepEqual(state.bookmarks, [questions[0].id]);
  assert.equal(state.draft, null);
  assert.equal(state.storageWarnings.length, 3);
  assert.equal(
    memory.data.get(storageKeys.sessions),
    corruptHistory,
    "A read must not rewrite storage.",
  );
  await store.saveSession(completedSession(1));
  const recovery = [...memory.data].find(([key]) =>
    key.includes("/recovery/sessions/"),
  );
  assert.equal(recovery?.[1], corruptHistory);
  assert.equal((await store.getSavedState()).sessions.length, 2);
});

test("failed storage reads cannot overwrite existing history and queued writes recover after failures", async () => {
  const memory = new MemoryStorage();
  memory.data.set(storageKeys.sessions, encode([completedSession()]));
  const originalHistory = memory.data.get(storageKeys.sessions);
  const store = createPracticeStore(memory);
  memory.failReads.add(storageKeys.sessions);
  assert.equal((await store.getSavedState()).storageWarnings.length, 1);
  await assert.rejects(
    store.saveSession(completedSession(1)),
    /Unavailable storage/,
  );
  assert.equal(memory.data.get(storageKeys.sessions), originalHistory);
  memory.failReads.clear();
  memory.failWrites.add(storageKeys.draft);
  await assert.rejects(
    store.saveDraft(createSession("career", 1)),
    /Storage is full/,
  );
  memory.failWrites.clear();
  await store.saveSession(completedSession(1));
  assert.equal((await store.getSavedState()).sessions.length, 2);
});

test("deleting history retains drafts and bookmarks; reset removes only this app’s data and recovery copies", async () => {
  const memory = new MemoryStorage();
  memory.data.set("another-app/key", "unrelated data");
  const store = createPracticeStore(memory);
  await store.saveSession(completedSession());
  await store.saveSession(completedSession(1));
  await store.saveDraft(createSession("career", 1));
  await store.setBookmark(questions[0].id, true);
  await store.deleteSession("saved-0");
  assert.deepEqual(
    (await store.getSavedState()).sessions.map((session) => session.id),
    ["saved-1"],
  );
  await store.clearHistory();
  const state = await store.getSavedState();
  assert.deepEqual(state.sessions, []);
  assert.ok(state.draft);
  assert.deepEqual(state.bookmarks, [questions[0].id]);
  memory.data.set(
    `${storageKeys.draft.replace(/draft$/, "")}recovery/draft/1`,
    "old raw data",
  );
  await store.clearAllPractice();
  assert.deepEqual([...memory.data], [["another-app/key", "unrelated data"]]);
});

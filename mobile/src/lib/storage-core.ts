import {
  getQuestion,
  MAX_SAVED_SESSIONS,
  parsePracticeSession,
  type PracticeSession,
  type SavedState,
} from "./domain";

/** Small adapter keeps native storage outside the domain and enables real race/failure tests. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}

const PREFIX = "@mockinterview/mobile/v1/";
export const storageKeys = {
  draft: `${PREFIX}draft`,
  sessions: `${PREFIX}sessions`,
  bookmarks: `${PREFIX}bookmarks`,
};

interface Decoded<T> {
  value: T;
  damaged: boolean;
  raw: string | null;
}

function parseEnvelope(raw: string | null): {
  value: unknown;
  damaged: boolean;
} {
  if (raw === null) return { value: undefined, damaged: false };
  try {
    const envelope: unknown = JSON.parse(raw);
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("version" in envelope) ||
      envelope.version !== 1 ||
      !("value" in envelope)
    )
      return { value: undefined, damaged: true };
    return { value: envelope.value, damaged: false };
  } catch {
    return { value: undefined, damaged: true };
  }
}

function sortedSessions(sessions: PracticeSession[]): PracticeSession[] {
  return [...sessions].sort(
    (a, b) =>
      Date.parse(b.completedAt ?? b.startedAt) -
      Date.parse(a.completedAt ?? a.startedAt),
  );
}

function decodeDraft(raw: string | null): Decoded<PracticeSession | null> {
  const envelope = parseEnvelope(raw);
  if (raw === null) return { value: null, damaged: false, raw };
  if (envelope.value === null && !envelope.damaged)
    return { value: null, damaged: false, raw };
  const session = parsePracticeSession(envelope.value);
  return { value: session, damaged: envelope.damaged || session === null, raw };
}

function decodeSessions(raw: string | null): Decoded<PracticeSession[]> {
  const envelope = parseEnvelope(raw);
  if (raw === null) return { value: [], damaged: false, raw };
  if (envelope.damaged || !Array.isArray(envelope.value))
    return { value: [], damaged: true, raw };
  const sessions: PracticeSession[] = [];
  let damaged = false;
  for (const record of envelope.value) {
    const session = parsePracticeSession(record);
    if (
      !session?.completedAt ||
      sessions.some((existing) => existing.id === session.id)
    )
      damaged = true;
    else sessions.push(session);
  }
  return {
    value: sortedSessions(sessions).slice(0, MAX_SAVED_SESSIONS),
    damaged,
    raw,
  };
}

function decodeBookmarks(raw: string | null): Decoded<string[]> {
  const envelope = parseEnvelope(raw);
  if (raw === null) return { value: [], damaged: false, raw };
  if (envelope.damaged || !Array.isArray(envelope.value))
    return { value: [], damaged: true, raw };
  const bookmarks: string[] = [];
  let damaged = false;
  for (const id of envelope.value) {
    if (typeof id !== "string" || !getQuestion(id)) damaged = true;
    else if (!bookmarks.includes(id)) bookmarks.push(id);
  }
  return { value: bookmarks, damaged, raw };
}

/**
 * Local, device-only persistence. Writes are ordered and copy caller-owned data.
 * Sections are independent, so a malformed draft cannot discard valid history.
 * Damaged raw data is preserved under a recovery key before that section is repaired.
 * Read failures remain visible; a failed read never turns into an empty successful write.
 */
export function createPracticeStore(storage: KeyValueStorage) {
  let pending: Promise<unknown> = Promise.resolve();
  let recoverySequence = 0;

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = pending.then(work);
    pending = result.catch(() => undefined);
    return result;
  }

  async function write<T>(
    key: string,
    decoded: Decoded<T>,
    value: T,
  ): Promise<void> {
    if (decoded.damaged && decoded.raw !== null) {
      // If the backup cannot be stored, leave the original untouched and reject.
      const recoveryKey = `${PREFIX}recovery/${key.slice(PREFIX.length)}/${Date.now()}-${++recoverySequence}`;
      await storage.setItem(recoveryKey, decoded.raw);
    }
    await storage.setItem(key, JSON.stringify({ version: 1, value }));
  }

  function getSavedState(): Promise<SavedState> {
    return serial(async () => {
      const storageWarnings: string[] = [];
      async function read<T>(
        key: string,
        decode: (raw: string | null) => Decoded<T>,
        fallback: T,
        label: string,
      ): Promise<T> {
        try {
          const decoded = decode(await storage.getItem(key));
          if (decoded.damaged)
            storageWarnings.push(
              `Some ${label} could not be read. Valid practice data is still available.`,
            );
          return decoded.value;
        } catch {
          storageWarnings.push(
            `Your ${label} could not be loaded from this device. Try reopening the app.`,
          );
          return fallback;
        }
      }
      const [draft, sessions, bookmarks] = await Promise.all([
        read(storageKeys.draft, decodeDraft, null, "draft data"),
        read(storageKeys.sessions, decodeSessions, [], "saved sessions"),
        read(storageKeys.bookmarks, decodeBookmarks, [], "saved questions"),
      ]);
      return { draft, sessions, bookmarks, storageWarnings };
    });
  }

  function saveDraft(session: PracticeSession | null): Promise<void> {
    const snapshot = session === null ? null : parsePracticeSession(session);
    if (session !== null && snapshot === null)
      return Promise.reject(
        new Error(
          "This practice draft could not be saved because its data is invalid.",
        ),
      );
    return serial(async () => {
      const previous = decodeDraft(await storage.getItem(storageKeys.draft));
      await write(storageKeys.draft, previous, snapshot);
    });
  }

  /** Returns pruned sessions so the native layer can remove their unreferenced audio files. */
  function saveSession(session: PracticeSession): Promise<PracticeSession[]> {
    const snapshot = parsePracticeSession(session);
    if (!snapshot?.completedAt)
      return Promise.reject(
        new Error("Complete this practice before saving it to your history."),
      );
    return serial(async () => {
      const previous = decodeSessions(
        await storage.getItem(storageKeys.sessions),
      );
      const all = sortedSessions([
        snapshot,
        ...previous.value.filter((saved) => saved.id !== snapshot.id),
      ]);
      const next = all.slice(0, MAX_SAVED_SESSIONS);
      await write(storageKeys.sessions, previous, next);
      // History is durable first. On a failed draft clear, the answer remains recoverable.
      const draft = decodeDraft(await storage.getItem(storageKeys.draft));
      if (draft.value?.id === snapshot.id)
        await write(storageKeys.draft, draft, null);
      return all.slice(MAX_SAVED_SESSIONS);
    });
  }

  function deleteSession(id: string): Promise<void> {
    return serial(async () => {
      const previous = decodeSessions(
        await storage.getItem(storageKeys.sessions),
      );
      await write(
        storageKeys.sessions,
        previous,
        previous.value.filter((session) => session.id !== id),
      );
    });
  }

  function setBookmark(questionId: string, bookmarked: boolean): Promise<void> {
    if (!getQuestion(questionId))
      return Promise.reject(
        new Error("This practice question is not available."),
      );
    return serial(async () => {
      const previous = decodeBookmarks(
        await storage.getItem(storageKeys.bookmarks),
      );
      const next = previous.value.filter((id) => id !== questionId);
      if (bookmarked) next.push(questionId);
      await write(storageKeys.bookmarks, previous, next);
    });
  }

  function clearHistory(): Promise<void> {
    return serial(async () => {
      // An explicit clear does not retain history in a recovery copy.
      const keys = await storage.getAllKeys();
      for (const key of keys.filter(
        (key) =>
          key === storageKeys.sessions ||
          key.startsWith(`${PREFIX}recovery/sessions/`),
      )) {
        await storage.removeItem(key);
      }
    });
  }

  function clearAllPractice(): Promise<void> {
    return serial(async () => {
      const keys = await storage.getAllKeys();
      for (const key of keys.filter((key) => key.startsWith(PREFIX)))
        await storage.removeItem(key);
    });
  }

  return {
    getSavedState,
    saveDraft,
    saveSession,
    deleteSession,
    setBookmark,
    clearHistory,
    clearAllPractice,
  };
}

export type PracticeStore = ReturnType<typeof createPracticeStore>;

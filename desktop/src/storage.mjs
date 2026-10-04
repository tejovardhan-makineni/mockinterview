import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PREFERENCES, validatePreferences } from "./security.mjs";

export async function writePrivateJSON(filename, value) {
  const temporary = `${filename}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, filename);
  await chmod(filename, 0o600);
}

export async function installSecrets(
  directory,
  safeStorage,
  platform = process.platform,
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if (
    !safeStorage.isEncryptionAvailable() ||
    (platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text")
  ) {
    throw new Error(
      "Secure credential storage is unavailable. Unlock your system keychain (on Linux, GNOME Keyring or KWallet), then reopen Mock Interview. Your saved interviews have not been changed.",
    );
  }
  const filename = path.join(directory, "install-secrets.json");
  let existing;
  try {
    existing = JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT")
      throw new Error(
        "The saved app keys could not be read. Restore your app-data backup; do not delete the keys separately from the database.",
      );
  }
  if (existing) {
    try {
      const secrets = JSON.parse(
        safeStorage.decryptString(Buffer.from(existing.encrypted, "base64")),
      );
      if (
        existing.version !== 1 ||
        !/^[a-f0-9]{64}$/.test(secrets.jwtSecret) ||
        Buffer.from(secrets.encryptionKey, "base64").length !== 32
      )
        throw new Error("Invalid keys");
      return secrets;
    } catch {
      throw new Error(
        "Your system keychain could not unlock the app keys. Unlock the original keychain and reopen Mock Interview. Your saved interviews have not been changed.",
      );
    }
  }
  const secrets = {
    jwtSecret: randomBytes(32).toString("hex"),
    encryptionKey: randomBytes(32).toString("base64"),
  };
  await writePrivateJSON(filename, {
    version: 1,
    encrypted: safeStorage
      .encryptString(JSON.stringify(secrets))
      .toString("base64"),
  });
  return secrets;
}

export function preferencesStore(directory) {
  const filename = path.join(directory, "preferences.json");
  let queue = Promise.resolve();
  async function read() {
    try {
      const { analyticsSince, resultsSince, ...stored } = JSON.parse(
        await readFile(filename, "utf8"),
      );
      const preferences = validatePreferences(stored);
      return {
        ...preferences,
        analyticsSince:
          preferences.shareAnalytics &&
          Number.isSafeInteger(analyticsSince) &&
          analyticsSince > 0
            ? analyticsSince
            : 0,
        resultsSince:
          preferences.shareInterviewResults &&
          Number.isSafeInteger(resultsSince) &&
          resultsSince > 0
            ? resultsSince
            : 0,
      };
    } catch {
      return { ...DEFAULT_PREFERENCES, analyticsSince: 0, resultsSince: 0 };
    }
  }
  return {
    get: () => queue.then(read),
    set: (patch) => {
      const checked = validatePreferences(patch, true);
      const operation = queue.then(async () => {
        const previous = await read();
        const next = { ...previous, ...checked };
        next.analyticsSince = next.shareAnalytics
          ? (previous.shareAnalytics && previous.analyticsSince) || Date.now()
          : 0;
        next.resultsSince = next.shareInterviewResults
          ? (previous.shareInterviewResults && previous.resultsSince) ||
            Date.now()
          : 0;
        await writePrivateJSON(filename, next);
        return next;
      });
      queue = operation.catch(() => {});
      return operation;
    },
  };
}

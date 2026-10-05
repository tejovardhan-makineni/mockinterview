import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { installSecrets, preferencesStore } from "../src/storage.mjs";

const safe = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (value) => Buffer.from(value).map((byte) => byte ^ 57),
  decryptString: (value) =>
    Buffer.from(value)
      .map((byte) => byte ^ 57)
      .toString(),
};

test("install keys persist encrypted across launches and corrupted keys are never replaced", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mockinterview-keys-"),
  );
  try {
    const first = await installSecrets(directory, safe, "linux");
    const next = await installSecrets(directory, safe, "linux");
    assert.deepEqual(next, first);
    assert.equal(Buffer.from(first.encryptionKey, "base64").length, 32);
    const file = path.join(directory, "install-secrets.json");
    assert.equal(
      (await readFile(file, "utf8")).includes(first.jwtSecret),
      false,
    );
    if (process.platform !== "win32")
      assert.equal((await stat(file)).mode & 0o777, 0o600);
    await writeFile(file, "broken");
    await assert.rejects(
      installSecrets(directory, safe, "linux"),
      /could not be read/,
    );
    assert.equal(await readFile(file, "utf8"), "broken");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("insecure Linux plaintext fallback is refused", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mockinterview-insecure-"),
  );
  try {
    await assert.rejects(
      installSecrets(
        directory,
        { ...safe, getSelectedStorageBackend: () => "basic_text" },
        "linux",
      ),
      /Secure credential storage is unavailable/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("analytics defaults on, result sharing stays off, timestamps are shell-owned, and concurrent saves survive restarts", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mockinterview-prefs-"),
  );
  try {
    const preferences = preferencesStore(directory);
    const start = Date.now();
    const initial = await preferences.get();
    assert.ok(initial.analyticsSince >= start);
    assert.deepEqual(initial, {
      shareAnalytics: true,
      shareInterviewResults: false,
      analyticsSince: initial.analyticsSince,
      resultsSince: 0,
      theme: "system",
    });
    await Promise.all([
      preferences.set({ shareAnalytics: true }),
      preferences.set({ theme: "dark" }),
    ]);
    const enabled = await preferencesStore(directory).get();
    assert.equal(enabled.theme, "dark");
    assert.equal(enabled.shareAnalytics, true);
    assert.ok(enabled.analyticsSince >= start);
    assert.equal(enabled.resultsSince, 0);
    await preferences.set({ shareAnalytics: true });
    assert.equal(
      (await preferences.get()).analyticsSince,
      enabled.analyticsSince,
    );
    await preferences.set({ shareAnalytics: false });
    assert.equal((await preferencesStore(directory).get()).analyticsSince, 0);
    assert.throws(() => preferences.set({ analyticsSince: 1 }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { childEnvironment, parseReady } from "../src/security.mjs";

const root = path.resolve(
  process.argv[2] ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../resources"),
);
const directory = await mkdtemp(
  path.join(os.tmpdir(), "mockinterview-runtime-"),
);
const bridgeToken = randomBytes(32).toString("hex");
const env = childEnvironment(process.env, {
  bridgeToken,
  jwtSecret: randomBytes(32).toString("hex"),
  encryptionKey: randomBytes(32).toString("base64"),
  database: path.join(directory, "test.sqlite"),
  web: path.join(root, "web"),
  corpus: path.join(root, "corpus"),
  packs: path.join(root, "packs"),
});
let child;
async function start() {
  child = spawn(
    path.join(
      root,
      "bin",
      process.platform === "win32"
        ? "mockinterview-api.exe"
        : "mockinterview-api",
    ),
    [],
    { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.resume();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Engine readiness timed out")),
      30000,
    );
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const address = parseReady(line);
      if (address) {
        clearTimeout(timer);
        resolve(address);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Engine exited before readiness (${code})`));
    });
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    const closed = once(child, "exit");
    child.kill("SIGTERM");
    await closed;
  }
}
const headers = { "X-Desktop-Token": bridgeToken };
try {
  let origin = await start();
  assert.equal((await fetch(`${origin}/api/v1/desktop/bootstrap`)).status, 403);
  assert.equal((await fetch(`${origin}/`, { headers })).status, 200);
  const bootstrap = await (
    await fetch(`${origin}/api/v1/desktop/bootstrap`, { headers })
  ).json();
  assert.ok(bootstrap.token);
  assert.ok(bootstrap.user.id);
  const authHeaders = {
    ...headers,
    Authorization: `Bearer ${bootstrap.token}`,
    "Content-Type": "application/json",
  };
  const denied = await fetch(`${origin}/api/v1/sessions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ funding: "platform" }),
  });
  assert.equal(denied.status, 400);
  assert.equal((await denied.json()).code, "personal_key_required");
  assert.equal(
    (
      await fetch(`${origin}/desktop/remote/api/v1/sessions`, {
        method: "POST",
        headers,
      })
    ).status,
    404,
  );
  const questions = await (
    await fetch(`${origin}/api/v1/questions`, { headers })
  ).json();
  assert.ok(
    (Array.isArray(questions) ? questions : questions.questions).length > 100,
  );
  const config = await (
    await fetch(`${origin}/api/v1/config`, { headers: authHeaders })
  ).json();
  const saved = await fetch(`${origin}/api/v1/config`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ ...config, intensity: 5 }),
  });
  assert.equal(saved.status, 200);
  await stop();
  origin = await start();
  const persisted = await (
    await fetch(`${origin}/api/v1/desktop/bootstrap`, { headers })
  ).json();
  assert.equal(
    persisted.user.id,
    bootstrap.user.id,
    "Local profile must survive process restart",
  );
  const restoredConfig = await (
    await fetch(`${origin}/api/v1/config`, {
      headers: { ...headers, Authorization: `Bearer ${persisted.token}` },
    })
  ).json();
  assert.equal(
    restoredConfig.intensity,
    5,
    "Saved interview preferences must survive process restart",
  );
  console.log(
    "Desktop runtime smoke passed: packaged assets, secret boundary, catalog, own-key policy and restart persistence.",
  );
} finally {
  await stop();
  await rm(directory, { recursive: true, force: true });
}

#!/usr/bin/env node
// MIT licensed. Cross-platform local launcher; never changes your .env.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const options = new Set(process.argv.slice(2));
const supported = new Set(["--persistent", "--skip-install", "--check", "--help"]);
for (const option of options) {
  if (!supported.has(option)) {
    console.error(`Unknown option: ${option}. Run node scripts/local.mjs --help.`);
    process.exit(1);
  }
}
if (options.has("--help")) {
  console.log(`mockinterview local web app

Usage: node scripts/local.mjs [--persistent] [--skip-install] [--check]

Default: Docker-free demo; accounts and history reset when stopped.
--persistent   Save to PostgreSQL configured with DATABASE_URL in .env.
--skip-install Reuse existing web dependencies (run npm ci after updates).
--check        Check prerequisites and ports without installing or starting.

Requires Git (to clone), Node.js 22/npm 10, and Go 1.26.8+.
Open http://localhost:3000. Ctrl+C stops both services.
Override ports with MOCKINTERVIEW_API_PORT and MOCKINTERVIEW_WEB_PORT.
No native desktop installer or automatic remote analytics upload is included.
See docs/LOCAL-SETUP.md for durable local storage and model keys.`);
  process.exit(0);
}

const apiPort = process.env.MOCKINTERVIEW_API_PORT || "8080";
const webPort = process.env.MOCKINTERVIEW_WEB_PORT || "3000";
for (const port of [apiPort, webPort]) {
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) {
    console.error("Local ports must be integers between 1024 and 65535.");
    process.exit(1);
  }
}
if (apiPort === webPort) {
  console.error("API and web ports must be different.");
  process.exit(1);
}
const webURL = `http://localhost:${webPort}`;
const environment = {
  ...process.env,
  APP_ENV: "development",
  LOCAL_UNLIMITED: "true",
  LOCAL_MEMORY: options.has("--persistent") ? "false" : "true",
  LISTEN_HOST: "127.0.0.1",
  PORT: apiPort,
  CORS_ALLOW: `${webURL},http://127.0.0.1:${webPort}`,
  PUBLIC_URL: webURL,
  NEXT_PUBLIC_API_BASE: `http://localhost:${apiPort}`,
  NEXT_PUBLIC_MOCK: "0",
};
let temporaryDirectory;
let stopping = false;
const children = new Set();

function command(program, args, cwd, output = "inherit") {
  const npmOnWindows = process.platform === "win32" && program === "npm";
  const child = spawn(npmOnWindows ? "npm.cmd" : program, args, {
    cwd,
    env: environment,
    stdio: output === "capture" ? ["ignore", "pipe", "pipe"] : "inherit",
    // Only the fixed npm command uses a Windows shell. No user text is interpolated.
    shell: npmOnWindows,
    windowsHide: true,
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", () => children.delete(child));
  return child;
}
function run(program, args, cwd, output = "inherit") {
  return new Promise((resolveRun, reject) => {
    const child = command(program, args, cwd, output);
    let result = "";
    if (output === "capture") {
      child.stdout.on("data", chunk => { result += chunk; });
      child.stderr.on("data", chunk => { result += chunk; });
    }
    child.once("error", error => reject(new Error(`Cannot run ${program}: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun(result.trim());
      else reject(new Error(`${program} ${args[0] || ""} stopped (${signal || code}). ${output === "capture" ? result.trim() : "See output above."}`));
    });
  });
}
async function checkPort(port) {
  await new Promise((resolvePort, reject) => {
    const listener = createServer();
    listener.once("error", () => reject(new Error(`Port ${port} is in use. Stop the existing service or set MOCKINTERVIEW_API_PORT / MOCKINTERVIEW_WEB_PORT.`)));
    listener.listen(+port, "127.0.0.1", () => listener.close(resolvePort));
  });
}
async function stop(exitCode) {
  if (stopping) return;
  stopping = true;
  const current = [...children];
  await Promise.all(current.map(child => new Promise(resolveStop => {
    if (child.exitCode !== null || !child.pid) { resolveStop(); return; }
    child.once("exit", resolveStop);
    if (process.platform === "win32") {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      killer.once("error", () => { child.kill(); resolveStop(); });
      killer.once("exit", resolveStop);
    } else {
      child.kill("SIGTERM");
    }
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolveStop(); }, 5000);
    timeout.unref();
  })));
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  process.exit(exitCode);
}
process.on("SIGINT", () => { void stop(0); });
process.on("SIGTERM", () => { void stop(0); });

try {
  if (Number(process.versions.node.split(".")[0]) !== 22) {
    throw new Error(`Use Node.js 22 (this project supports Node 22/npm 10). Current: ${process.version}.`);
  }
  const goVersion = await run("go", ["version"], join(root, "api"), "capture");
  const npmVersion = await run("npm", ["--version"], root, "capture");
  if (!npmVersion.startsWith("10.")) throw new Error(`Use npm 10 with Node.js 22. Current npm: ${npmVersion}.`);
  await checkPort(apiPort);
  await checkPort(webPort);
  console.log(`Prerequisites found: Node ${process.version}, npm ${npmVersion}, ${goVersion}.`);
  if (options.has("--check")) {
    console.log("Prerequisite and port checks passed. PostgreSQL/provider connectivity is checked at startup.");
    process.exit(0);
  }
  console.log(options.has("--persistent")
    ? "Persistent mode: PostgreSQL must be running; DATABASE_URL is read from .env."
    : "LOCAL DEMO: accounts and history live in memory and RESET when stopped.\nUse --persistent with PostgreSQL to keep your interviews. No central analytics upload is configured by this launcher.");
  if (!options.has("--skip-install")) {
    await run("npm", ["ci", "--no-audit", "--no-fund"], join(root, "web"));
  } else if (!existsSync(join(root, "web/node_modules/next/dist/bin/next"))) {
    throw new Error("Web dependencies are missing. Run again without --skip-install.");
  }
  await run(process.execPath, ["scripts/vendor-assets.mjs"], join(root, "web"));
  temporaryDirectory = await mkdtemp(join(tmpdir(), "mockinterview-"));
  const executable = join(temporaryDirectory, process.platform === "win32" ? "mockinterview.exe" : "mockinterview");
  await run("go", ["build", "-o", executable, "./cmd/mockinterview"], join(root, "api"));
  const api = command(executable, [], join(root, "api"));
  const web = command(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", webPort], join(root, "web"));
  for (const service of [api, web]) {
    service.once("error", error => { console.error(error.message); void stop(1); });
    service.once("exit", code => { if (!stopping) { console.error("A local service stopped; closing the other service."); void stop(code || 1); } });
  }
  console.log(`\nOpening address: ${webURL}\nWait for Next.js to report Ready, then open that address. Ctrl+C stops the app.\nCreate a local account. Without a model key, choose Text conversation for the labeled example demo.\n`);
} catch (error) {
  console.error(`\nLocal setup could not continue: ${error.message}`);
  await stop(1);
}

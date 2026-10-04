import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// Reviewed 2026-10-04; remove this exception when braces publishes a fix.
// https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
// braces 3.0.3 (latest) can exhaust the stack on attacker-controlled glob
// patterns. Its only remaining path is the Next ESLint plugin's file globbing:
// eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch.
// It processes repository paths during lint, never interview input, and is not
// shipped in the Firebase static export. Every affected package must remain a
// development-only dependency. No production dependency or other advisory is
// exempted. This exception expires at the start of 2026-11-04 UTC.
const BRACES_ADVISORY = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const EXPIRES = Date.parse("2026-11-04T00:00:00Z");
const REVIEWED_PACKAGES = new Set([
  "braces",
  "micromatch",
  "fast-glob",
  "@next/eslint-plugin-next",
  "eslint-config-next",
]);

export function assessAudit(audit, lock, now = Date.now()) {
  if (
    audit?.error ||
    !audit?.vulnerabilities ||
    typeof audit.vulnerabilities !== "object" ||
    !audit?.metadata?.vulnerabilities ||
    !lock?.packages
  ) {
    throw new Error("Dependency audit did not return a valid report and lockfile.");
  }
  const entries = audit.vulnerabilities;
  function allowed(name, visiting = new Set()) {
    const entry = entries[name];
    if (
      now >= EXPIRES ||
      !Number.isFinite(now) ||
      entry?.severity !== "high" ||
      !REVIEWED_PACKAGES.has(name) ||
      visiting.has(name) ||
      !Array.isArray(entry?.nodes) ||
      !entry.nodes.length ||
      !entry.nodes.every((node) => lock.packages[node]?.dev === true) ||
      !Array.isArray(entry?.via) ||
      !entry.via.length
    ) return false;
    const seen = new Set(visiting).add(name);
    return entry.via.every((cause) => {
      if (typeof cause === "string") return allowed(cause, seen);
      return (
        name === "braces" &&
        cause?.name === "braces" &&
        cause?.url === BRACES_ADVISORY &&
        cause?.severity === "high" &&
        entry.nodes.every((node) => lock.packages[node].version === "3.0.3")
      );
    });
  }
  const blocked = [];
  const accepted = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!["info", "low", "moderate", "high", "critical"].includes(entry?.severity)) {
      throw new Error("Dependency audit returned an unknown severity.");
    }
    if (!["high", "critical"].includes(entry.severity)) continue;
    (allowed(name) ? accepted : blocked).push(name);
  }
  return { blocked, accepted };
}

function main() {
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  const npmPath = process.env.npm_execpath;
  const result = spawnSync(
    npmPath ? process.execPath : "npm",
    [...(npmPath ? [npmPath] : []), "audit", "--json"],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, shell: !npmPath && process.platform === "win32" },
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error("npm audit failed to run; dependency security was not verified.");
  }
  const report = assessAudit(
    JSON.parse(result.stdout),
    JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")),
  );
  if (report.accepted.length) {
    console.log(`Temporary dev-only exception: ${BRACES_ADVISORY}; expires 2026-11-04 UTC (${report.accepted.join(", ")}).`);
  }
  if (report.blocked.length) {
    console.error(`Unaccepted high/critical vulnerabilities: ${report.blocked.join(", ")}. Run npm audit for details.`);
    process.exitCode = 1;
  } else console.log("Dependency audit passed: no unaccepted high/critical vulnerabilities.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); }
  catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

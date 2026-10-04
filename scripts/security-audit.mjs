import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assessAudit as assessWebAudit } from "../web/scripts/security-audit.mjs";

const PROJECTS = new Set(["web", "mobile", "desktop"]);
const SEVERITIES = ["info", "low", "moderate", "high", "critical"];
const root = fileURLToPath(new URL("../", import.meta.url));

// This runner deliberately has no mobile/desktop advisory exceptions. Expo's
// tooling remains security-relevant even when it is absent from app bundles.
// Keep the original, dated web-only lint exception in its existing assessor.
export function assessProjectAudit(project, audit, lock, now = Date.now()) {
  if (!PROJECTS.has(project)) throw new Error("Choose web, mobile or desktop.");
  if (
    audit?.error ||
    audit?.auditReportVersion !== 2 ||
    !audit?.vulnerabilities ||
    typeof audit.vulnerabilities !== "object" ||
    Array.isArray(audit.vulnerabilities) ||
    !audit?.metadata?.vulnerabilities ||
    !lock?.packages ||
    typeof lock.packages !== "object" ||
    Array.isArray(lock.packages)
  )
    throw new Error(
      "Dependency audit returned an incomplete report or lockfile.",
    );
  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, 0]),
  );
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    if (
      entry?.name !== name ||
      !SEVERITIES.includes(entry?.severity) ||
      !Array.isArray(entry.nodes) ||
      !entry.nodes.length ||
      !entry.nodes.every(
        (node) => typeof node === "string" && lock.packages[node]?.version,
      ) ||
      !Array.isArray(entry.via) ||
      !entry.via.length
    ) {
      throw new Error(
        "Dependency audit contains an invalid finding or an unknown lockfile node.",
      );
    }
    counts[entry.severity]++;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (
    !SEVERITIES.every(
      (severity) =>
        audit.metadata.vulnerabilities[severity] === counts[severity],
    ) ||
    audit.metadata.vulnerabilities.total !== total
  ) {
    throw new Error(
      "Dependency audit finding counts do not match the report metadata.",
    );
  }
  const decision =
    project === "web"
      ? assessWebAudit(audit, lock, now)
      : {
          accepted: [],
          blocked: Object.entries(audit.vulnerabilities)
            .filter(([, entry]) =>
              ["high", "critical"].includes(entry.severity),
            )
            .map(([name]) => name),
        };
  return { project, counts: { ...counts, total }, ...decision };
}

export function parseArguments(args) {
  const [project, ...rest] = args;
  if (
    !PROJECTS.has(project) ||
    !(
      rest.length === 0 ||
      (rest.length === 2 && rest[0] === "--report-dir" && rest[1])
    )
  ) {
    throw new Error(
      "Usage: node scripts/security-audit.mjs web|mobile|desktop [--report-dir PATH]",
    );
  }
  return { project, reportDirectory: rest[1] ? path.resolve(rest[1]) : null };
}

export function runAudit(args = process.argv.slice(2)) {
  const { project, reportDirectory } = parseArguments(args);
  const lockText = readFileSync(
    path.join(root, project, "package-lock.json"),
    "utf8",
  );
  const npmPath = process.env.npm_execpath;
  const result = spawnSync(
    npmPath ? process.execPath : "npm",
    [
      ...(npmPath ? [npmPath] : []),
      "audit",
      "--json",
      "--include=dev",
      "--include=optional",
      "--include=peer",
    ],
    {
      cwd: path.join(root, project),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 120000,
      shell: !npmPath && process.platform === "win32",
    },
  );
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(
      `${project}: npm audit did not complete; security was not verified.`,
    );
  }
  const audit = JSON.parse(result.stdout);
  const now = Date.now();
  const report = {
    ...assessProjectAudit(project, audit, JSON.parse(lockText), now),
    auditedAt: new Date(now).toISOString(),
    lockfileSHA256: createHash("sha256").update(lockText).digest("hex"),
  };
  if (reportDirectory) {
    mkdirSync(reportDirectory, { recursive: true });
    writeFileSync(
      path.join(reportDirectory, `${project}-npm-audit.json`),
      `${JSON.stringify(audit, null, 2)}\n`,
    );
    writeFileSync(
      path.join(reportDirectory, `${project}-audit-decision.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
  }
  console.log(
    `${project}: ${report.counts.total} npm findings (${report.counts.high} high, ${report.counts.critical} critical).`,
  );
  if (report.accepted.length) {
    console.log(
      `Reviewed vulnerabilities remain: ${report.accepted.join(", ")}. The existing web-only lint exception expires 2026-11-04 UTC; this is not a vulnerability fix.`,
    );
  }
  if (report.blocked.length) {
    console.error(
      `BLOCKED: ${report.blocked.join(", ")}. No matching security exception; do not release this dependency tree.`,
    );
    return 1;
  }
  console.log(
    report.accepted.length
      ? "Audit policy passed with the existing documented exception."
      : "No high/critical dependency findings.",
  );
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = runAudit();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

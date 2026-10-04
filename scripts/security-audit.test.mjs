import assert from "node:assert/strict";
import test from "node:test";
import { assessProjectAudit, parseArguments } from "./security-audit.mjs";

const now = Date.parse("2026-10-04T00:00:00Z");
function fixture() {
  return {
    audit: {
      auditReportVersion: 2,
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: 0,
          high: 1,
          critical: 0,
          total: 1,
        },
      },
      vulnerabilities: {
        braces: {
          name: "braces",
          severity: "high",
          nodes: ["node_modules/braces"],
          via: [
            {
              name: "braces",
              severity: "high",
              url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
            },
          ],
        },
      },
    },
    lock: {
      packages: { "node_modules/braces": { version: "3.0.3", dev: true } },
    },
  };
}

test("existing web lint exception cannot silently spread to desktop", () => {
  const { audit, lock } = fixture();
  assert.deepEqual(assessProjectAudit("web", audit, lock, now).accepted, [
    "braces",
  ]);
  const report = assessProjectAudit("desktop", audit, lock, now);
  assert.deepEqual(report.accepted, []);
  assert.deepEqual(report.blocked, ["braces"]);
});

test("expired or production-shipped web exception still fails", () => {
  const { audit, lock } = fixture();
  assert.deepEqual(
    assessProjectAudit("web", audit, lock, Date.parse("2026-11-04")).blocked,
    ["braces"],
  );
  delete lock.packages["node_modules/braces"].dev;
  assert.deepEqual(assessProjectAudit("web", audit, lock, now).blocked, [
    "braces",
  ]);
});

test("node-forge stays blocked even if its advisory is development-only", () => {
  const { audit, lock } = fixture();
  delete audit.vulnerabilities.braces;
  audit.vulnerabilities["node-forge"] = {
    name: "node-forge",
    severity: "high",
    nodes: ["node_modules/node-forge"],
    via: [
      {
        name: "node-forge",
        severity: "high",
        url: "https://github.com/advisories/GHSA-86w9-cpqp-85rv",
      },
    ],
  };
  lock.packages["node_modules/node-forge"] = { version: "1.4.0", dev: true };
  for (const project of ["web", "desktop"]) {
    assert.deepEqual(assessProjectAudit(project, audit, lock, now).blocked, [
      "node-forge",
    ]);
  }
});

test("malformed, inconsistent or unknown-node reports cannot pass", () => {
  const { audit, lock } = fixture();
  assert.throws(() =>
    assessProjectAudit("desktop", { ...audit, error: {} }, lock),
  );
  assert.throws(() =>
    assessProjectAudit("desktop", { ...audit, auditReportVersion: 1 }, lock),
  );
  const incomplete = structuredClone(audit);
  incomplete.vulnerabilities = {};
  assert.throws(
    () => assessProjectAudit("desktop", incomplete, lock),
    /counts/,
  );
  const unknown = structuredClone(audit);
  unknown.vulnerabilities.braces.nodes = ["node_modules/unknown"];
  assert.throws(() => assessProjectAudit("desktop", unknown, lock), /unknown/);
  const malformed = structuredClone(audit);
  malformed.vulnerabilities.braces.severity = "unknown";
  assert.throws(() => assessProjectAudit("desktop", malformed, lock));
});

test("only explicit project selection and report output options are accepted", () => {
  assert.deepEqual(parseArguments(["desktop"]), {
    project: "desktop",
    reportDirectory: null,
  });
  assert.ok(
    parseArguments([
      "desktop",
      "--report-dir",
      "audit-results",
    ]).reportDirectory.endsWith("audit-results"),
  );
  for (const args of [
    [],
    ["unsupported-app"],
    ["../private"],
    ["desktop", "--omit=dev"],
    ["web", "--ignore", "braces"],
    ["desktop", "--report-dir"],
  ])
    assert.throws(() => parseArguments(args));
  const { audit, lock } = fixture();
  assert.throws(
    () => assessProjectAudit("unsupported-app", audit, lock),
    /Choose web or desktop/,
  );
});

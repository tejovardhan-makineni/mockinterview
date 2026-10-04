import assert from "node:assert/strict";
import test from "node:test";
import { assessAudit } from "./security-audit.mjs";

const now = Date.parse("2026-10-04T00:00:00Z");
function fixture() {
  return {
    audit: {
      metadata: { vulnerabilities: { high: 2, critical: 0 } },
      vulnerabilities: {
        braces: {
          severity: "high", nodes: ["node_modules/braces"],
          via: [{ name: "braces", severity: "high", url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }],
        },
        micromatch: { severity: "high", nodes: ["node_modules/micromatch"], via: ["braces"] },
      },
    },
    lock: { packages: {
      "node_modules/braces": { version: "3.0.3", dev: true },
      "node_modules/micromatch": { version: "4.0.8", dev: true },
    } },
  };
}

test("allows only the reviewed dev-only advisory and inherited chain", () => {
  const { audit, lock } = fixture();
  assert.deepEqual(assessAudit(audit, lock, now), { blocked: [], accepted: ["braces", "micromatch"] });
});
test("fails if the affected dependency becomes production-shipped", () => {
  const { audit, lock } = fixture();
  delete lock.packages["node_modules/braces"].dev;
  assert.deepEqual(assessAudit(audit, lock, now).blocked, ["braces", "micromatch"]);
});
test("fails after the time-limited review expires", () => {
  const { audit, lock } = fixture();
  assert.equal(assessAudit(audit, lock, Date.parse("2026-11-04T00:00:00Z")).blocked.length, 2);
});
test("does not exempt a different advisory in the same dependency", () => {
  const { audit, lock } = fixture();
  audit.vulnerabilities.braces.via.push({ name: "braces", severity: "high", url: "https://github.com/advisories/unknown" });
  assert.equal(assessAudit(audit, lock, now).blocked.length, 2);
});
test("fails unrelated high and critical advisories, even in dev tools", () => {
  const { audit, lock } = fixture();
  audit.vulnerabilities.other = { severity: "critical", nodes: [], via: [] };
  assert.deepEqual(assessAudit(audit, lock, now).blocked, ["other"]);
});
test("fails closed on incomplete reports, cycles, or unknown package versions", () => {
  const { audit, lock } = fixture();
  assert.throws(() => assessAudit({ error: {} }, lock, now));
  audit.vulnerabilities.braces.via = ["micromatch"];
  assert.equal(assessAudit(audit, lock, now).blocked.length, 2);
  const next = fixture();
  next.lock.packages["node_modules/braces"].version = "3.0.4";
  assert.equal(assessAudit(next.audit, next.lock, now).blocked.length, 2);
});

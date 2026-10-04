import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function run(event, setting = "") {
  const directory = mkdtempSync(path.join(tmpdir(), "deployment-readiness-"));
  const output = path.join(directory, "output");
  const summary = path.join(directory, "summary");
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./deployment-readiness.mjs", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: event,
          PRODUCTION_DEPLOY_ENABLED: setting,
          GITHUB_OUTPUT: output,
          GITHUB_STEP_SUMMARY: summary,
        },
      },
    );
    return {
      ...result,
      output: readFileSync(output, "utf8"),
      summary: setting === "true" ? "" : readFileSync(summary, "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("automatic deployment waits for setup without failing routine merges", () => {
  for (const setting of ["", "false", "TRUE", "1"]) {
    const result = run("workflow_run", setting);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "enabled=false\n");
    assert.match(result.summary, /No build, cloud authentication or deployment/);
  }
});

test("an explicit release cannot report success while deployment is inactive", () => {
  const result = run("workflow_dispatch");
  assert.equal(result.status, 1);
  assert.equal(result.output, "enabled=false\n");
  assert.match(result.summary, /GITHUB-DEPLOYMENT/);
});

test("completed setup enables both automatic and explicit release paths", () => {
  for (const event of ["workflow_run", "workflow_dispatch"]) {
    const result = run(event, "true");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, "enabled=true\n");
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildTargets } from "../scripts/build-targets.mjs";
import { releaseArtifacts } from "../scripts/release-assets.mjs";
import { releaseNotes } from "../scripts/release-notes.mjs";

test("every release target builds exactly its required native receipt set", () => {
  for (const target of ["all", "linux", "macos", "windows"]) {
    const matrix = buildTargets(target);
    assert.deepEqual(
      matrix.include.map((entry) => `desktop-${entry.name}`),
      releaseArtifacts(target),
    );
    for (const entry of matrix.include) {
      assert.match(entry.runner, /^(ubuntu|macos|windows)-/);
      assert.equal(
        entry.target === "darwin",
        entry.runner.startsWith("macos-"),
      );
    }
  }
  assert.equal(buildTargets("macos").include.length, 2);
  assert.deepEqual(
    buildTargets("linux").include.map((entry) => entry.runner),
    ["ubuntu-latest"],
  );
  assert.throws(() => buildTargets(""));
  assert.throws(() => buildTargets("untrusted-runner"));
});

test("Linux release notes claim only Linux checks and show the actual distribution limits", () => {
  const notes = releaseNotes({
    version: "0.1.0-beta.2",
    target: "linux",
    component: "desktop",
    repository: "tejovardhan-makineni/mockinterview",
  });
  assert.match(notes, /Linux x64/);
  assert.match(notes, /do not claim an operating-system code signature/);
  assert.match(notes, /do not certify microphone/);
  assert.doesNotMatch(
    notes,
    /apps are Developer ID signed|have verified, timestamped Authenticode/,
  );
});

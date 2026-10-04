import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion,
  compareVersions,
  assertNewVersion,
  checksReady,
  installerNames,
  desktopManifest,
  REQUIRED_WORKFLOWS,
} from "./release-policy.mjs";

test("versions reject shell, tag and traversal input and order prereleases correctly", () => {
  for (const v of [
    "01.2.3",
    "1.2",
    "v1.2.3",
    "1.2.3;echo bad",
    "../main",
    "1.2.3\n",
    "1.2.3-beta.-1",
  ])
    assert.throws(() => parseVersion(v));
  for (const [a, b] of [
    ["1.1.0", "1.0.9"],
    ["1.0.0", "1.0.0-rc.8"],
    ["1.0.0-rc.1", "1.0.0-beta.9"],
    ["1.0.0-beta.10", "1.0.0-beta.9"],
  ])
    assert(compareVersions(a, b) > 0);
  assert.throws(() =>
    assertNewVersion("0.9.0", "web", [
      { tag_name: "web-v1.0.0", draft: false },
    ]),
  );
  assert.throws(() =>
    assertNewVersion("1.0.0", "desktop", [
      { tag_name: "desktop-v1.0.0", draft: true },
    ]),
  );
});

test("deploy requires all exact-main push workflows, including latest failed reruns", () => {
  const runs = REQUIRED_WORKFLOWS.map((file, i) => ({
    id: i + 1,
    path: `.github/workflows/${file}`,
    head_sha: "abc",
    head_branch: "main",
    event: "push",
    status: "completed",
    conclusion: "success",
  }));
  assert(checksReady(runs, "abc"));
  assert(!checksReady(runs, "other"));
  assert(!checksReady(runs.slice(1), "abc"));
  assert(
    !checksReady(
      runs.map((r) => ({ ...r, event: "pull_request" })),
      "abc",
    ),
  );
  assert(
    !checksReady(
      [...runs, { ...runs[0], id: 10, conclusion: "failure" }],
      "abc",
    ),
  );
});

test("downloads require a complete public stable release with hashes", () => {
  const r = {
    tag_name: "desktop-v1.0.0",
    draft: false,
    prerelease: false,
    assets: [
      ...installerNames("1.0.0").map((name) => ({
        name,
        state: "uploaded",
        size: 100,
        digest: `sha256:${"a".repeat(64)}`,
      })),
      { name: "RELEASE-MANIFEST.json", state: "uploaded" },
    ],
  };
  assert.equal(desktopManifest(r).assets.length, 5);
  assert.throws(() => desktopManifest({ ...r, draft: true }));
  assert.throws(() => desktopManifest({ ...r, prerelease: true }));
  assert.throws(() => desktopManifest({ ...r, assets: r.assets.slice(1) }));
  assert.throws(() =>
    desktopManifest({
      ...r,
      assets: r.assets.map((a) => ({ ...a, digest: null })),
    }),
  );
});

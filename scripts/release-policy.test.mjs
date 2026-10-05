import test from "node:test";
import assert from "node:assert/strict";
import {
  parseVersion,
  compareVersions,
  assertNewVersion,
  checksReady,
  installerNames,
  desktopPlatforms,
  mergeDesktopManifests,
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

function desktopFixture(version = "1.0.0", target = "all") {
  const metadata = {
    schemaVersion: 1,
    component: "desktop",
    repository: "tejovardhan-makineni/mockinterview",
    version,
    target,
    sourceSha: "a".repeat(40),
    verification: {
      checksums: "verified",
      provenance: "same-run-native-CI-receipts",
    },
    files: installerNames(version, target).map((name) => ({
      name,
      bytes: 100,
      sha256: "a".repeat(64),
      platform: name.includes("-mac-")
        ? "macos"
        : name.includes("-windows-")
          ? "windows"
          : "linux",
      signing: name.includes("-linux-")
        ? { status: "not-applicable", method: "none" }
        : {
            status: "verified",
            method: name.includes("-mac-")
              ? "developer-id-and-notarization"
              : "authenticode",
          },
    })),
  };
  return {
    metadata,
    release: {
      tag_name: `desktop-v${version}`,
      draft: false,
      prerelease: version.includes("-"),
      assets: [
        ...metadata.files.map((file) => ({
          name: file.name,
          state: "uploaded",
          size: file.bytes,
          digest: `sha256:${file.sha256}`,
        })),
        { name: "RELEASE-MANIFEST.json", state: "uploaded" },
      ],
    },
  };
}

test("downloads require metadata and matching published installer bytes", () => {
  const { release, metadata } = desktopFixture();
  assert.equal(desktopManifest(release, metadata).assets.length, 5);
  assert.throws(() => desktopManifest({ ...release, draft: true }, metadata));
  assert.throws(() => desktopManifest(release));
  assert.throws(() =>
    desktopManifest({ ...release, assets: release.assets.slice(1) }, metadata),
  );
  assert.throws(() =>
    desktopManifest(
      {
        ...release,
        assets: release.assets.map((a) => ({ ...a, digest: null })),
      },
      metadata,
    ),
  );
  assert.throws(() =>
    desktopManifest(release, {
      ...metadata,
      files: metadata.files.map((file) => ({ ...file, bytes: 999 })),
    }),
  );
  assert.throws(() =>
    desktopManifest(release, {
      ...metadata,
      files: metadata.files.map((file) => ({
        ...file,
        signing: { status: "not-applicable", method: "none" },
      })),
    }),
  );
});

test("verified public beta downloads and complete individual platforms are supported", () => {
  for (const [target, count] of [
    ["all", 5],
    ["linux", 2],
    ["macos", 2],
    ["windows", 1],
  ]) {
    const { release, metadata } = desktopFixture("0.1.0-beta.2", target);
    const manifest = desktopManifest(release, metadata);
    assert.equal(manifest.assets.length, count);
    assert.equal(manifest.prerelease, true);
    assert.throws(() =>
      desktopManifest(
        { ...release, assets: release.assets.slice(1) },
        metadata,
      ),
    );
  }
  for (const target of ["", "mac", "../linux", "linux,windows", "all\n"])
    assert.throws(() => desktopPlatforms(target));
});

test("a new single-platform release preserves older downloads for other platforms", () => {
  const linux = desktopFixture("1.1.0", "linux"),
    previous = desktopFixture("1.0.0");
  const merged = mergeDesktopManifests([
    desktopManifest(linux.release, linux.metadata),
    desktopManifest(previous.release, previous.metadata),
  ]);
  assert.equal(merged.assets.length, 5);
  assert.equal(
    merged.assets.filter((asset) => asset.platform === "linux").length,
    2,
  );
  assert(
    merged.assets
      .filter((asset) => asset.platform === "linux")
      .every((asset) => asset.tag === "desktop-v1.1.0"),
  );
  assert(
    merged.assets
      .filter((asset) => asset.platform !== "linux")
      .every((asset) => asset.tag === "desktop-v1.0.0"),
  );
  assert.equal(mergeDesktopManifests([]), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACTS,
  RECEIPT_NAME,
  CHECKSUM_NAME,
  SIGNING_CHECKS,
  artifactInstallers,
  parseChecksums,
  releaseContext,
  stageReleaseAssets,
  verifiedDownloadManifest,
  releaseArtifacts,
} from "../scripts/release-assets.mjs";
import { installerNames } from "../../scripts/release-policy.mjs";

const env = {
  RELEASE_VERSION: "1.2.3",
  RELEASE_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "2",
};
const signing = {
  macos: {
    status: "verified",
    method: "developer-id-and-notarization",
    publisher: "Developer ID Application: Example (ABCD123456)",
    teamId: "ABCD123456",
  },
  windows: {
    status: "verified",
    method: "authenticode",
    publisher: "Example",
    thumbprint: "B".repeat(40),
  },
  linux: { status: "not-applicable", method: "none" },
};
async function fixture(t, target = "all") {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "mockinterview-release-assets-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "artifacts"),
    output = path.join(root, "publish");
  await mkdir(input);
  for (const artifact of releaseArtifacts(target)) {
    const policy = ARTIFACTS[artifact];
    const directory = path.join(input, artifact);
    await mkdir(directory);
    const files = [];
    for (const name of artifactInstallers(env.RELEASE_VERSION, artifact)) {
      const bytes = Buffer.from(`installer fixture: ${name}\n`);
      await writeFile(path.join(directory, name), bytes);
      files.push({
        name,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
    await writeFile(
      path.join(directory, CHECKSUM_NAME),
      files.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n",
    );
    await writeFile(
      path.join(directory, RECEIPT_NAME),
      JSON.stringify({
        schemaVersion: 1,
        ...releaseContext({ ...env, RELEASE_TARGET: target }),
        artifact,
        platform: policy.platform,
        verifiedAt: new Date().toISOString(),
        signing: signing[policy.platform],
        checks: SIGNING_CHECKS[policy.platform],
        files,
      }),
    );
  }
  return { root, input, output };
}
async function expectUnpublished(output) {
  await assert.rejects(readFile(path.join(output, "RELEASE-MANIFEST.json")), {
    code: "ENOENT",
  });
}

test("staging verifies all original checksums and emits exactly seven installers plus provenance", async (t) => {
  const f = await fixture(t);
  const manifest = await stageReleaseAssets(f.input, f.output, env);
  assert.equal(manifest.files.length, 7);
  assert.equal(manifest.sourceSha, env.RELEASE_SHA);
  assert.equal(manifest.ci.runId, env.GITHUB_RUN_ID);
  assert.deepEqual(
    (await readdir(f.output)).sort(),
    [
      ...installerNames(env.RELEASE_VERSION),
      CHECKSUM_NAME,
      "RELEASE-MANIFEST.json",
    ].sort(),
  );
  const checksums = parseChecksums(
    await readFile(path.join(f.output, CHECKSUM_NAME), "utf8"),
    installerNames(env.RELEASE_VERSION),
  );
  for (const file of manifest.files)
    assert.equal(
      createHash("sha256")
        .update(await readFile(path.join(f.output, file.name)))
        .digest("hex"),
      checksums.get(file.name),
    );
  assert.equal(
    manifest.files.find((file) => file.platform === "linux").signing.status,
    "not-applicable",
  );
  assert.equal(manifest.platformVerification.length, 4);
  await assert.rejects(
    stageReleaseAssets(f.input, f.output, env),
    /already exists/,
  );
});

test("tampered or empty installers fail before any output is created", async (t) => {
  for (const content of ["modified installer", ""])
    await t.test(content || "empty", async (t) => {
      const f = await fixture(t);
      const artifact = "desktop-windows-x64";
      await writeFile(
        path.join(
          f.input,
          artifact,
          artifactInstallers(env.RELEASE_VERSION, artifact)[0],
        ),
        content,
      );
      await assert.rejects(
        stageReleaseAssets(f.input, f.output, env),
        /checksum mismatch|Empty release file/,
      );
      await expectUnpublished(f.output);
    });
});

test("missing, duplicate and traversal checksum entries cannot be staged", async (t) => {
  const artifact = "desktop-mac-arm64",
    names = artifactInstallers(env.RELEASE_VERSION, artifact);
  for (const checksum of [
    "",
    `${"a".repeat(64)}  ../outside.exe\n`,
    `${"a".repeat(64)}  ${names[0]}\n${"a".repeat(64)}  ${names[0]}\n`,
  ]) {
    const f = await fixture(t);
    await writeFile(path.join(f.input, artifact, CHECKSUM_NAME), checksum);
    await assert.rejects(
      stageReleaseAssets(f.input, f.output, env),
      /checksum entry|Missing platform/,
    );
    await expectUnpublished(f.output);
  }
});

test("missing platforms, wrong versions and unexpected executable files are rejected", async (t) => {
  for (const mutation of [
    async (f) =>
      rm(path.join(f.input, "desktop-mac-arm64"), { recursive: true }),
    async (f) =>
      writeFile(
        path.join(f.input, "desktop-linux-x64", "extra.exe"),
        "unexpected",
      ),
    async (f) =>
      rm(
        path.join(
          f.input,
          "desktop-windows-x64",
          artifactInstallers(env.RELEASE_VERSION, "desktop-windows-x64")[0],
        ),
      ),
  ]) {
    const f = await fixture(t);
    await mutation(f);
    await assert.rejects(
      stageReleaseAssets(f.input, f.output, env),
      /Expected exactly|Unexpected or missing/,
    );
    await expectUnpublished(f.output);
  }
  const f = await fixture(t);
  await assert.rejects(
    stageReleaseAssets(f.input, f.output, { ...env, RELEASE_VERSION: "1.2.4" }),
    /Unexpected or missing/,
  );
});

test("receipts must bind native verification to the exact source, version, run and installer bytes", async (t) => {
  for (const mutation of [
    (receipt) => {
      receipt.sourceSha = "b".repeat(40);
    },
    (receipt) => {
      receipt.version = "1.2.4";
    },
    (receipt) => {
      receipt.ci.runId = "999";
    },
    (receipt) => {
      receipt.ci.runAttempt = "1";
    },
    (receipt) => {
      receipt.files[0].sha256 = "0".repeat(64);
    },
    (receipt) => {
      receipt.signing.status = "not-applicable";
    },
    (receipt) => {
      receipt.signing.publisher = "ad-hoc";
    },
    (receipt) => {
      receipt.checks = [];
    },
  ]) {
    const f = await fixture(t);
    const file = path.join(f.input, "desktop-mac-arm64", RECEIPT_NAME);
    const receipt = JSON.parse(await readFile(file));
    mutation(receipt);
    await writeFile(file, JSON.stringify(receipt));
    await assert.rejects(
      stageReleaseAssets(f.input, f.output, env),
      /receipt|not verified|verification checks/,
    );
    await expectUnpublished(f.output);
  }
});

test("linked installers and artifact directories are refused", async (t) => {
  const f = await fixture(t),
    artifact = "desktop-windows-x64",
    name = artifactInstallers(env.RELEASE_VERSION, artifact)[0];
  const original = path.join(f.input, artifact, name),
    outside = path.join(f.root, "outside.exe");
  await writeFile(outside, await readFile(original));
  await rm(original);
  try {
    await symlink(outside, original);
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error.code))
      return t.skip("Symlinks unavailable on this runner");
    throw error;
  }
  await assert.rejects(
    stageReleaseAssets(f.input, f.output, env),
    /Unexpected or missing/,
  );
  await expectUnpublished(f.output);
  const other = await fixture(t);
  await rm(path.join(other.input, artifact), { recursive: true });
  await symlink(
    path.join(f.input, artifact),
    path.join(other.input, artifact),
    "junction",
  );
  await assert.rejects(
    stageReleaseAssets(other.input, other.output, env),
    /Expected exactly/,
  );
});

test("release inputs cannot inject filenames or impersonate another CI repository", () => {
  for (const RELEASE_VERSION of [
    "../outside",
    "1.2.3\n",
    "1.2.3;echo bad",
    "",
    "v1.2.3",
  ])
    assert.throws(() => releaseContext({ ...env, RELEASE_VERSION }));
  for (const patch of [
    { RELEASE_SHA: "main" },
    { GITHUB_RUN_ID: "../123" },
    { GITHUB_REPOSITORY: "other/repo" },
    { GITHUB_RUN_URL: "https://attacker.test/run" },
  ])
    assert.throws(() => releaseContext({ ...env, ...patch }));
});

test("Linux publication is independent of unavailable macOS and Windows certificates", async (t) => {
  const f = await fixture(t, "linux");
  const manifest = await stageReleaseAssets(f.input, f.output, {
    ...env,
    RELEASE_TARGET: "linux",
  });
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.platformVerification.length, 1);
  assert.deepEqual(manifest.verification.platforms, {
    linux: "not-applicable",
  });
  assert.deepEqual(
    (await readdir(f.output)).sort(),
    [
      ...installerNames(env.RELEASE_VERSION, "linux"),
      CHECKSUM_NAME,
      "RELEASE-MANIFEST.json",
    ].sort(),
  );
});

test("selected platforms must be complete and cannot include unselected artifacts", async (t) => {
  for (const target of ["linux", "macos", "windows"]) {
    const f = await fixture(t, target);
    const artifact = releaseArtifacts(target)[0];
    await rm(path.join(f.input, artifact), { recursive: true });
    await assert.rejects(
      stageReleaseAssets(f.input, f.output, { ...env, RELEASE_TARGET: target }),
      /selected desktop/,
    );
  }
  const f = await fixture(t);
  await assert.rejects(
    stageReleaseAssets(f.input, f.output, { ...env, RELEASE_TARGET: "linux" }),
    /selected desktop/,
  );
});

test("published downloads recheck native receipts against the exact uploaded files", async (t) => {
  const f = await fixture(t, "linux");
  const metadata = await stageReleaseAssets(f.input, f.output, {
    ...env,
    RELEASE_TARGET: "linux",
  });
  const release = {
    tag_name: `desktop-v${env.RELEASE_VERSION}`,
    draft: false,
    prerelease: false,
    assets: [
      ...metadata.files.map((file) => ({
        name: file.name,
        size: file.bytes,
        digest: `sha256:${file.sha256}`,
        state: "uploaded",
      })),
      { name: "RELEASE-MANIFEST.json", state: "uploaded" },
    ],
  };
  assert.equal(verifiedDownloadManifest(release, metadata).assets.length, 2);
  for (const mutate of [
    (m) => {
      m.platformVerification = [];
    },
    (m) => {
      m.platformVerification[0].ci.runId = "999";
    },
    (m) => {
      m.platformVerification[0].files[0].sha256 = "b".repeat(64);
    },
    (m) => {
      m.platformVerification[0].checks = [];
    },
    (m) => {
      m.platformVerification[0].target = "all";
    },
  ]) {
    const copy = structuredClone(metadata);
    mutate(copy);
    assert.throws(() => verifiedDownloadManifest(release, copy));
  }
});

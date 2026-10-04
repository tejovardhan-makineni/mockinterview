import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { installerNames, REPOSITORY } from "../../scripts/release-policy.mjs";

export const RECEIPT_NAME = "SIGNING-VERIFICATION.json";
export const CHECKSUM_NAME = "SHA256SUMS.txt";
export const ARTIFACTS = Object.freeze({
  "desktop-mac-arm64": {
    platform: "macos",
    packageDirectory: "mac-arm64",
    match: "-mac-arm64.",
  },
  "desktop-mac-x64": {
    platform: "macos",
    packageDirectory: "mac",
    match: "-mac-x64.",
  },
  "desktop-windows-x64": {
    platform: "windows",
    packageDirectory: "win-unpacked",
    match: "-windows-x64-setup.exe",
  },
  "desktop-linux-x64": {
    platform: "linux",
    packageDirectory: "linux-unpacked",
    match: "-linux-",
  },
});
export const SIGNING_CHECKS = Object.freeze({
  macos: [
    "app-deep-codesign",
    "bundled-api-codesign",
    "developer-id-team",
    "hardened-runtime",
    "app-gatekeeper",
    "app-notarization-ticket",
    "dmg-notarization-ticket",
  ],
  windows: [
    "installer-authenticode",
    "app-authenticode",
    "bundled-api-authenticode",
    "expected-publisher",
    "trusted-timestamp",
  ],
  linux: ["native-linux-build-metadata", "installer-checksums"],
});
export function artifactInstallers(version, artifact) {
  assert(Object.hasOwn(ARTIFACTS, artifact), "Unknown desktop artifact");
  return installerNames(version).filter((name) =>
    name.includes(ARTIFACTS[artifact].match),
  );
}
export function releaseContext(env = process.env) {
  const version = env.RELEASE_VERSION;
  installerNames(version); // One version parser and filename policy for the release.
  assert(
    /^[a-f0-9]{40}$/.test(env.RELEASE_SHA || ""),
    "RELEASE_SHA must be a full source commit",
  );
  assert(
    /^[1-9]\d*$/.test(env.GITHUB_RUN_ID || ""),
    "GITHUB_RUN_ID is required",
  );
  assert(
    !env.GITHUB_REPOSITORY || env.GITHUB_REPOSITORY === REPOSITORY,
    "Release verification is disabled in forks",
  );
  const runAttempt = env.GITHUB_RUN_ATTEMPT || "1";
  assert(/^[1-9]\d*$/.test(runAttempt), "Invalid GITHUB_RUN_ATTEMPT");
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  assert(
    !env.GITHUB_RUN_URL || env.GITHUB_RUN_URL === runUrl,
    "GITHUB_RUN_URL does not match this repository and run",
  );
  return {
    version,
    sourceSha: env.RELEASE_SHA,
    repository: REPOSITORY,
    ci: { runId: env.GITHUB_RUN_ID, runAttempt, runUrl },
  };
}
async function regularFile(filename) {
  const info = await lstat(filename);
  assert(
    info.isFile() && !info.isSymbolicLink(),
    `Expected a regular file: ${path.basename(filename)}`,
  );
  const handle = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
  );
  try {
    const opened = await handle.stat();
    assert(
      opened.isFile() && opened.dev === info.dev && opened.ino === info.ino,
      `File changed while opening: ${path.basename(filename)}`,
    );
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function fileDigest(filename) {
  const file = await regularFile(filename);
  try {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    assert(bytes > 0, `Empty release file: ${path.basename(filename)}`);
    return { sha256: hash.digest("hex"), bytes };
  } finally {
    await file.close();
  }
}
async function readMetadata(filename) {
  const file = await regularFile(filename);
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length;
      assert(size <= 64 * 1024, "Release verification metadata is too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await file.close();
  }
}
export function parseChecksums(text, expected) {
  const found = new Map();
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ([^/\\\r\n]+)$/.exec(line);
    assert(
      match && expected.includes(match[2]),
      "Unexpected or unsafe checksum entry",
    );
    assert(!found.has(match[2]), `Duplicate checksum entry: ${match[2]}`);
    found.set(match[2], match[1]);
  }
  assert(found.size === expected.length, "Missing platform installer checksum");
  return found;
}
export function validateReceipt(receipt, context, artifact, files) {
  const policy = ARTIFACTS[artifact];
  assert(
    receipt.schemaVersion === 1 &&
      receipt.artifact === artifact &&
      receipt.platform === policy.platform,
    "Signing receipt identity mismatch",
  );
  assert(
    receipt.version === context.version &&
      receipt.sourceSha === context.sourceSha &&
      receipt.repository === context.repository,
    "Signing receipt source/version mismatch",
  );
  assert(
    receipt.ci?.runId === context.ci.runId &&
      receipt.ci?.runAttempt === context.ci.runAttempt &&
      receipt.ci?.runUrl === context.ci.runUrl,
    "Signing receipt CI run mismatch",
  );
  assert(
    Number.isFinite(Date.parse(receipt.verifiedAt)),
    "Missing signing verification timestamp",
  );
  assert(
    Array.isArray(receipt.files) && receipt.files.length === files.length,
    "Signing receipt installer set mismatch",
  );
  const seen = new Set();
  for (const entry of receipt.files) {
    const actual = files.find((file) => file.name === entry.name);
    assert(
      actual &&
        !seen.has(entry.name) &&
        entry.sha256 === actual.sha256 &&
        entry.bytes === actual.bytes,
      "Signing receipt installer hash mismatch",
    );
    seen.add(entry.name);
  }
  assert(
    Array.isArray(receipt.checks) &&
      receipt.checks.length === SIGNING_CHECKS[policy.platform].length &&
      SIGNING_CHECKS[policy.platform].every((check) =>
        receipt.checks.includes(check),
      ),
    "Missing native signing verification checks",
  );
  const signing = receipt.signing;
  if (policy.platform === "macos") {
    assert(
      signing?.status === "verified" &&
        signing.method === "developer-id-and-notarization" &&
        /^[A-Z0-9]{10}$/.test(signing.teamId || "") &&
        signing.publisher?.startsWith("Developer ID Application: "),
      "macOS signing/notarization was not verified",
    );
  } else if (policy.platform === "windows") {
    assert(
      signing?.status === "verified" &&
        signing.method === "authenticode" &&
        typeof signing.publisher === "string" &&
        signing.publisher.trim() &&
        /^[a-fA-F0-9]{40,64}$/.test(signing.thumbprint || ""),
      "Windows publisher/signature was not verified",
    );
  } else {
    assert(
      signing?.status === "not-applicable" && signing.method === "none",
      "Linux must not claim code signing",
    );
  }
}
async function copyVerified(source, destination, expected) {
  const input = await regularFile(source);
  let output;
  try {
    output = await open(destination, "wx", 0o644);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of input.createReadStream({ autoClose: false })) {
      hash.update(chunk);
      bytes += chunk.length;
      await output.writeFile(chunk);
    }
    assert(
      hash.digest("hex") === expected.sha256 && bytes === expected.bytes,
      `Installer changed while staging: ${expected.name}`,
    );
  } finally {
    await Promise.all([input.close(), output?.close()]);
  }
}
export async function stageReleaseAssets(
  artifactRoot,
  destination,
  env = process.env,
) {
  const context = releaseContext(env);
  const root = path.resolve(artifactRoot),
    output = path.resolve(destination);
  assert(
    root !== output &&
      !output.startsWith(root + path.sep) &&
      !root.startsWith(output + path.sep),
    "Release output must be separate from artifact input",
  );
  const rootInfo = await lstat(root);
  assert(
    rootInfo.isDirectory() && !rootInfo.isSymbolicLink(),
    "Artifact root must be a real directory",
  );
  try {
    await lstat(output);
    assert.fail("Release output already exists; refusing to replace it");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const entries = await readdir(root, { withFileTypes: true });
  assert(
    entries.length === Object.keys(ARTIFACTS).length &&
      entries.every(
        (entry) =>
          Object.hasOwn(ARTIFACTS, entry.name) &&
          entry.isDirectory() &&
          !entry.isSymbolicLink(),
      ),
    "Expected exactly four desktop artifact directories",
  );
  const files = [],
    receipts = [];
  // Validate every platform's complete file set, original checksums and native
  // verification receipt before creating any publishable output.
  for (const artifact of Object.keys(ARTIFACTS)) {
    const directory = path.join(root, artifact),
      expected = artifactInstallers(context.version, artifact);
    const permitted = new Set([...expected, CHECKSUM_NAME, RECEIPT_NAME]);
    const members = await readdir(directory, { withFileTypes: true });
    assert(
      members.length === permitted.size &&
        members.every(
          (entry) =>
            permitted.has(entry.name) &&
            entry.isFile() &&
            !entry.isSymbolicLink(),
        ),
      `Unexpected or missing release files in ${artifact}`,
    );
    const checksums = parseChecksums(
      await readMetadata(path.join(directory, CHECKSUM_NAME)),
      expected,
    );
    const platformFiles = [];
    for (const name of expected) {
      const digest = await fileDigest(path.join(directory, name));
      assert(
        digest.sha256 === checksums.get(name),
        `Installer checksum mismatch: ${name}`,
      );
      platformFiles.push({ name, ...digest });
    }
    const receipt = JSON.parse(
      await readMetadata(path.join(directory, RECEIPT_NAME)),
    );
    validateReceipt(receipt, context, artifact, platformFiles);
    receipts.push(receipt);
    files.push(
      ...platformFiles.map((file) => ({
        ...file,
        artifact,
        platform: ARTIFACTS[artifact].platform,
        signing: receipt.signing,
      })),
    );
  }
  assert(
    files.length === installerNames(context.version).length,
    "Incomplete desktop release",
  );
  files.sort((a, b) => a.name.localeCompare(b.name, "en"));
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = await mkdtemp(
    path.join(path.dirname(output), ".desktop-release-"),
  );
  try {
    for (const file of files)
      await copyVerified(
        path.join(root, file.artifact, file.name),
        path.join(temporary, file.name),
        file,
      );
    const manifest = {
      schemaVersion: 1,
      component: "desktop",
      ...context,
      generatedAt: new Date().toISOString(),
      verification: {
        checksums: "verified",
        provenance: "same-run-native-CI-receipts",
        macosAndWindowsSigning: "verified",
        linuxSigning: "not-applicable",
      },
      files,
      platformVerification: receipts,
    };
    await writeFile(
      path.join(temporary, CHECKSUM_NAME),
      files.map((file) => `${file.sha256}  ${file.name}`).join("\n") + "\n",
      { flag: "wx" },
    );
    await writeFile(
      path.join(temporary, "RELEASE-MANIFEST.json"),
      JSON.stringify(manifest, null, 2) + "\n",
      { flag: "wx" },
    );
    await rename(temporary, output);
    return manifest;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  assert(
    process.argv.length === 4,
    "Usage: node release-assets.mjs ARTIFACT_ROOT OUTPUT_DIRECTORY",
  );
  const manifest = await stageReleaseAssets(process.argv[2], process.argv[3]);
  console.log(
    `Verified and staged ${manifest.files.length} desktop installers for ${manifest.version}.`,
  );
}

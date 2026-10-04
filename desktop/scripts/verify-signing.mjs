import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  ARTIFACTS,
  RECEIPT_NAME,
  SIGNING_CHECKS,
  artifactInstallers,
  fileDigest,
  releaseContext,
} from "./release-assets.mjs";

const executeFile = promisify(execFile);
async function nativeCommand(program, args, options = {}) {
  try {
    const result = await executeFile(program, args, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      ...options,
    });
    return result.stdout + result.stderr;
  } catch {
    // Native tools can echo environment-dependent signing configuration. Keep
    // failures actionable without forwarding command output or credentials.
    throw new Error(
      `Native signing verification failed: ${program} ${args[0] || ""}`,
    );
  }
}
export function verifyMacIdentity(details, expectedTeam, hardened = true) {
  assert(
    /^[A-Z0-9]{10}$/.test(expectedTeam || ""),
    "APPLE_TEAM_ID is required for release verification",
  );
  assert(
    !/^Signature=adhoc$/m.test(details),
    "Ad-hoc signatures cannot be published",
  );
  const publisher = /^Authority=(Developer ID Application: .+)$/m.exec(
    details,
  )?.[1];
  assert(
    publisher &&
      /^TeamIdentifier=(.+)$/m.exec(details)?.[1] === expectedTeam &&
      publisher.endsWith(`(${expectedTeam})`),
    "Expected Developer ID Application identity and Apple team",
  );
  if (hardened)
    assert(
      /^CodeDirectory .*flags=.*\bruntime\b/m.test(details),
      "The macOS application must use hardened runtime",
    );
  return publisher;
}
export function verifyWindowsIdentity(raw, expectedPublisher) {
  assert(
    typeof expectedPublisher === "string" &&
      expectedPublisher.trim() &&
      expectedPublisher.length <= 300 &&
      !/[\r\n]/.test(expectedPublisher),
    "DESKTOP_WINDOWS_PUBLISHER is required",
  );
  const result = JSON.parse(raw.replace(/^\uFEFF/, "").trim());
  assert(
    result.status === "Valid" &&
      result.publisher === expectedPublisher &&
      /^[a-fA-F0-9]{40,64}$/.test(result.thumbprint || ""),
    "Authenticode signature or configured publisher did not match",
  );
  assert(
    result.timestamped === true,
    "Release executables require an Authenticode timestamp",
  );
  return {
    publisher: result.publisher,
    thumbprint: result.thumbprint.toUpperCase(),
  };
}
const authenticodeScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$signature = Get-AuthenticodeSignature -LiteralPath $env:MOCKINTERVIEW_VERIFY_FILE
$publisher = if ($null -ne $signature.SignerCertificate) { $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }
[ordered]@{ status = $signature.Status.ToString(); publisher = $publisher; thumbprint = $signature.SignerCertificate.Thumbprint; timestamped = ($null -ne $signature.TimeStamperCertificate) } | ConvertTo-Json -Compress
`;
async function requireDirectory(directory) {
  const info = await lstat(directory);
  assert(
    info.isDirectory() && !info.isSymbolicLink(),
    `Expected a real packaged directory: ${path.basename(directory)}`,
  );
}
export async function verifySigning({
  directory = process.cwd(),
  env = process.env,
  platform = process.platform,
  run = nativeCommand,
} = {}) {
  const context = releaseContext(env),
    artifact = env.DESKTOP_ARTIFACT_NAME;
  assert(
    Object.hasOwn(ARTIFACTS, artifact),
    "DESKTOP_ARTIFACT_NAME is required",
  );
  const policy = ARTIFACTS[artifact];
  assert(
    env.DESKTOP_PACKAGE_DIR === policy.packageDirectory,
    "DESKTOP_PACKAGE_DIR does not match its platform artifact",
  );
  assert(
    { darwin: "macos", win32: "windows", linux: "linux" }[platform] ===
      policy.platform,
    "Signing must be verified on the native operating system",
  );
  const dist = path.resolve(directory, "dist"),
    packaged = path.join(dist, policy.packageDirectory);
  await requireDirectory(dist);
  await requireDirectory(packaged);
  const receiptPath = path.join(dist, RECEIPT_NAME);
  // A failed second verification must not leave an earlier success receipt.
  await rm(receiptPath, { force: true });
  const app = path.join(packaged, "Mock Interview.app");
  const runtime = path.join(
    policy.platform === "macos"
      ? path.join(app, "Contents/Resources")
      : path.join(packaged, "resources"),
    "runtime",
  );
  const build = JSON.parse(
    await readFile(path.join(runtime, "build.json"), "utf8"),
  );
  assert(
    build.source === context.sourceSha && build.version === context.version,
    "Packaged runtime source/version does not match release",
  );
  const expectedOS = { macos: "darwin", windows: "windows", linux: "linux" }[
    policy.platform
  ];
  const expectedArch = artifact === "desktop-mac-arm64" ? "arm64" : "amd64";
  assert(
    build.platform === expectedOS && build.arch === expectedArch,
    "Packaged runtime architecture does not match release",
  );
  const names = artifactInstallers(context.version, artifact);
  // Reject linked/empty installers before invoking any platform verification.
  for (const name of names) await fileDigest(path.join(dist, name));
  let signing;
  const checks = SIGNING_CHECKS[policy.platform];
  if (policy.platform === "macos") {
    await requireDirectory(app);
    const expectedTeam = env.APPLE_TEAM_ID;
    assert(
      /^[A-Z0-9]{10}$/.test(expectedTeam || ""),
      "APPLE_TEAM_ID is required for release verification",
    );
    await run("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      app,
    ]);
    const publisher = verifyMacIdentity(
      await run("codesign", ["--display", "--verbose=4", app]),
      expectedTeam,
    );
    const helper = path.join(runtime, "bin/mockinterview-api");
    await run("codesign", ["--verify", "--strict", "--verbose=2", helper]);
    verifyMacIdentity(
      await run("codesign", ["--display", "--verbose=4", helper]),
      expectedTeam,
    );
    await run("spctl", ["--assess", "--type", "execute", "--verbose=4", app]);
    await run("xcrun", ["stapler", "validate", app]);
    for (const name of names.filter((name) => name.endsWith(".dmg"))) {
      const dmg = path.join(dist, name);
      await run("xcrun", ["stapler", "validate", dmg]);
    }
    signing = {
      status: "verified",
      method: "developer-id-and-notarization",
      publisher,
      teamId: expectedTeam,
    };
  } else if (policy.platform === "windows") {
    const publisher = env.DESKTOP_WINDOWS_PUBLISHER;
    assert(
      typeof publisher === "string" && publisher.trim(),
      "DESKTOP_WINDOWS_PUBLISHER is required",
    );
    const executables = [
      ...names.map((name) => path.join(dist, name)),
      path.join(packaged, "Mock Interview.exe"),
      path.join(runtime, "bin/mockinterview-api.exe"),
    ];
    let identity;
    for (const executable of executables) {
      await fileDigest(executable);
      const current = verifyWindowsIdentity(
        await run(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            authenticodeScript,
          ],
          { env: { ...env, MOCKINTERVIEW_VERIFY_FILE: executable } },
        ),
        publisher,
      );
      if (identity)
        assert(
          current.thumbprint === identity.thumbprint,
          "All Windows executables must use the same release certificate",
        );
      identity = current;
    }
    signing = { status: "verified", method: "authenticode", ...identity };
  } else {
    signing = { status: "not-applicable", method: "none" };
  }
  const files = [];
  for (const name of names)
    files.push({ name, ...(await fileDigest(path.join(dist, name))) });
  const receipt = {
    schemaVersion: 1,
    ...context,
    artifact,
    platform: policy.platform,
    verifiedAt: new Date().toISOString(),
    signing,
    checks,
    files,
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", {
    flag: "wx",
    mode: 0o644,
  });
  return receipt;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  assert(process.argv.length === 2, "Usage: node scripts/verify-signing.mjs");
  const result = await verifySigning();
  console.log(
    `Native release verification passed for ${result.artifact}; signing: ${result.signing.status}.`,
  );
}

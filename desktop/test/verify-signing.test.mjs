import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ARTIFACTS,
  RECEIPT_NAME,
  artifactInstallers,
  releaseContext,
  validateReceipt,
} from "../scripts/release-assets.mjs";
import {
  verifyMacIdentity,
  verifyWindowsIdentity,
  verifySigning,
} from "../scripts/verify-signing.mjs";

const baseEnv = {
  RELEASE_VERSION: "1.2.3",
  RELEASE_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "12345",
  APPLE_TEAM_ID: "ABCD123456",
  DESKTOP_WINDOWS_PUBLISHER: "Example Publisher",
};
const macDetails =
  "Executable=Mock Interview\nCodeDirectory v=20500 size=100 flags=0x10000(runtime) hashes=100\nAuthority=Developer ID Application: Example Publisher (ABCD123456)\nTeamIdentifier=ABCD123456\n";
const windowsDetails = {
  status: "Valid",
  publisher: "Example Publisher",
  thumbprint: "A".repeat(40),
  timestamped: true,
};
async function fixture(t, artifact) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "mockinterview-signing-test-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const policy = ARTIFACTS[artifact],
    env = {
      ...baseEnv,
      DESKTOP_ARTIFACT_NAME: artifact,
      DESKTOP_PACKAGE_DIR: policy.packageDirectory,
    };
  const dist = path.join(directory, "dist"),
    packaged = path.join(dist, policy.packageDirectory);
  const runtime = path.join(
    packaged,
    policy.platform === "macos"
      ? "Mock Interview.app/Contents/Resources/runtime"
      : "resources/runtime",
  );
  await mkdir(path.join(runtime, "bin"), { recursive: true });
  const build = {
    source: env.RELEASE_SHA,
    version: env.RELEASE_VERSION,
    platform: { macos: "darwin", windows: "windows", linux: "linux" }[
      policy.platform
    ],
    arch: artifact.endsWith("arm64") ? "arm64" : "amd64",
  };
  await writeFile(path.join(runtime, "build.json"), JSON.stringify(build));
  await writeFile(
    path.join(
      runtime,
      "bin",
      policy.platform === "windows"
        ? "mockinterview-api.exe"
        : "mockinterview-api",
    ),
    "test runtime",
  );
  if (policy.platform === "windows")
    await writeFile(path.join(packaged, "Mock Interview.exe"), "test app");
  for (const name of artifactInstallers(env.RELEASE_VERSION, artifact))
    await writeFile(path.join(dist, name), "installer fixture: " + name);
  return {
    directory,
    dist,
    runtime,
    env,
    artifact,
    platform: { macos: "darwin", windows: "win32", linux: "linux" }[
      policy.platform
    ],
  };
}

test("macOS verifier requires Developer ID, correct team and hardened runtime", () => {
  assert.equal(
    verifyMacIdentity(macDetails, baseEnv.APPLE_TEAM_ID),
    "Developer ID Application: Example Publisher (ABCD123456)",
  );
  for (const text of [
    "Signature=adhoc\n",
    macDetails + "Signature=adhoc\n",
    macDetails.replaceAll("ABCD123456", "OTHER12345"),
    macDetails.replace("Developer ID Application", "Developer ID Installer"),
    macDetails.replace("0x10000(runtime)", "0x0(none)"),
  ])
    assert.throws(() => verifyMacIdentity(text, baseEnv.APPLE_TEAM_ID));
  assert.throws(() => verifyMacIdentity(macDetails, ""), /APPLE_TEAM_ID/);
});

test("macOS receipt is written only after app/helper signing, Gatekeeper and both notarization tickets pass", async (t) => {
  const f = await fixture(t, "desktop-mac-arm64"),
    calls = [];
  const run = async (program, args) => {
    calls.push({ program, args });
    return program === "codesign" && args[0] === "--display"
      ? macDetails
      : "verified";
  };
  const receipt = await verifySigning({ ...f, run });
  assert.equal(receipt.signing.status, "verified");
  assert.equal(
    calls.filter(
      (call) => call.program === "codesign" && call.args[0] === "--verify",
    ).length,
    2,
  );
  assert.ok(
    calls.some(
      (call) => call.program === "spctl" && call.args.includes("execute"),
    ),
  );
  const tickets = calls
    .filter((call) => call.program === "xcrun")
    .map((call) => call.args.at(-1));
  assert.ok(tickets.some((file) => file.endsWith(".app")));
  assert.ok(tickets.some((file) => file.endsWith(".dmg")));
  validateReceipt(receipt, releaseContext(f.env), f.artifact, receipt.files);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(f.dist, RECEIPT_NAME))),
    receipt,
  );
  // Reverification failure removes a previous success, so no stale receipt can
  // accidentally pass a subsequent staging step.
  await assert.rejects(
    verifySigning({
      ...f,
      run: async (program, args) => {
        if (program === "xcrun" && args.at(-1).endsWith(".dmg"))
          throw new Error("DMG ticket absent");
        return run(program, args);
      },
    }),
    /DMG ticket absent/,
  );
  await assert.rejects(readFile(path.join(f.dist, RECEIPT_NAME)), {
    code: "ENOENT",
  });
});

test("Windows requires a valid timestamped signature from exactly the configured publisher", () => {
  assert.equal(
    verifyWindowsIdentity(
      JSON.stringify(windowsDetails),
      baseEnv.DESKTOP_WINDOWS_PUBLISHER,
    ).publisher,
    "Example Publisher",
  );
  for (const patch of [
    { status: "NotSigned" },
    { status: "HashMismatch" },
    { publisher: "Example Publisher malicious suffix" },
    { timestamped: false },
    { thumbprint: "missing" },
  ])
    assert.throws(() =>
      verifyWindowsIdentity(
        JSON.stringify({ ...windowsDetails, ...patch }),
        baseEnv.DESKTOP_WINDOWS_PUBLISHER,
      ),
    );
  assert.throws(
    () => verifyWindowsIdentity(JSON.stringify(windowsDetails), ""),
    /DESKTOP_WINDOWS_PUBLISHER/,
  );
});

test("Windows verifies installer, app and bundled API without interpolating paths into PowerShell", async (t) => {
  const f = await fixture(t, "desktop-windows-x64"),
    paths = [];
  const run = async (program, args, options) => {
    assert.equal(program, "powershell.exe");
    assert.ok(args.includes("-NonInteractive"));
    const target = options.env.MOCKINTERVIEW_VERIFY_FILE;
    paths.push(target);
    assert.ok(!args.at(-1).includes(target));
    assert.ok(
      args.at(-1).includes("-LiteralPath $env:MOCKINTERVIEW_VERIFY_FILE"),
    );
    return JSON.stringify(windowsDetails);
  };
  const receipt = await verifySigning({ ...f, run });
  assert.equal(paths.length, 3);
  assert.ok(paths.some((name) => name.endsWith("-setup.exe")));
  assert.ok(paths.some((name) => name.endsWith("mockinterview-api.exe")));
  validateReceipt(receipt, releaseContext(f.env), f.artifact, receipt.files);
  let call = 0;
  await assert.rejects(
    verifySigning({
      ...f,
      run: async () =>
        JSON.stringify({
          ...windowsDetails,
          thumbprint: (++call === 2 ? "B" : "A").repeat(40),
        }),
    }),
    /same release certificate/,
  );
  await assert.rejects(readFile(path.join(f.dist, RECEIPT_NAME)), {
    code: "ENOENT",
  });
});

test("Linux receipt explicitly makes no signing claim and binds native source/version", async (t) => {
  const f = await fixture(t, "desktop-linux-x64");
  const receipt = await verifySigning({
    ...f,
    run: async () =>
      assert.fail("Linux must not pretend to run a signing verifier"),
  });
  assert.deepEqual(receipt.signing, {
    status: "not-applicable",
    method: "none",
  });
  validateReceipt(receipt, releaseContext(f.env), f.artifact, receipt.files);
  const buildPath = path.join(f.runtime, "build.json");
  const build = JSON.parse(await readFile(buildPath));
  await writeFile(
    buildPath,
    JSON.stringify({ ...build, source: "b".repeat(40) }),
  );
  await assert.rejects(verifySigning(f), /source\/version/);
  await assert.rejects(readFile(path.join(f.dist, RECEIPT_NAME)), {
    code: "ENOENT",
  });
});

test("cross-platform, unknown package and absent publisher configurations fail closed", async (t) => {
  const f = await fixture(t, "desktop-windows-x64");
  await assert.rejects(
    verifySigning({ ...f, platform: "linux" }),
    /native operating system/,
  );
  await assert.rejects(
    verifySigning({
      ...f,
      env: { ...f.env, DESKTOP_PACKAGE_DIR: "../outside" },
    }),
    /DESKTOP_PACKAGE_DIR/,
  );
  await assert.rejects(
    verifySigning({ ...f, env: { ...f.env, DESKTOP_WINDOWS_PUBLISHER: "" } }),
    /DESKTOP_WINDOWS_PUBLISHER/,
  );
  const mac = await fixture(t, "desktop-mac-x64");
  await assert.rejects(
    verifySigning({ ...mac, env: { ...mac.env, APPLE_TEAM_ID: "" } }),
    /APPLE_TEAM_ID/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Use electron-builder's existing YAML dependency, without another package.
const builderRequire = createRequire(
  require.resolve("app-builder-lib/package.json"),
);
const { load } = builderRequire("js-yaml");
const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const workflow = load(
  readFileSync(
    new URL("../../.github/workflows/desktop-build.yml", import.meta.url),
    "utf8",
  ),
);
const packages = workflow.jobs.packages;
const signingVariable = /^(?:CSC_|WIN_CSC_|APPLE_)/;

function packagingSteps() {
  const steps = packages.steps.filter((step) =>
    /\bnpm run dist\b/.test(step.run || ""),
  );
  assert.equal(
    steps.length,
    2,
    "Preview and public packaging must be separate",
  );
  const preview = steps.find(
    (step) => step.if === "inputs.release_version == ''",
  );
  const release = steps.find(
    (step) => step.if === "inputs.release_version != ''",
  );
  assert.ok(preview, "Missing versionless preview packaging");
  assert.ok(release, "Missing explicit public release packaging");
  return { preview, release };
}

// Exercise the installed builder's actual environment handling and certificate
// importer. Native keychain creation and identity lookup are replaced BEFORE
// constructing the packager: this never signs files or touches real keychains.
// The isolated child emulates a macOS main/push even when CI itself runs on a PR
// or on another OS, which is what the former PR-only checks failed to exercise.
const signingProbe = String.raw`
const { createRequire } = require("node:module");
const path = require("node:path");
const requireDesktop = createRequire(path.join(process.cwd(), "package.json"));
Object.defineProperty(process, "platform", { value: "darwin" });
// Initialize the public entry first, as electron-builder does; its internal
// platform classes refer back to the index during CommonJS initialization.
requireDesktop("app-builder-lib");
const codeSign = requireDesktop("app-builder-lib/out/codeSign/macCodeSign");
const { importCertificate } = requireDesktop("app-builder-lib/out/codeSign/codesign");
const { MacPackager } = requireDesktop("app-builder-lib/out/macPackager");
const config = requireDesktop("./electron-builder.cjs");
const metadata = requireDesktop("./package.json");
let certificateImports = 0;
codeSign.createKeychain = async ({ cscLink, currentDir }) => {
  certificateImports++;
  // Only reproduce the known empty-path case, never import a real certificate.
  if (cscLink !== "") throw new Error("Unexpected certificate in isolated probe");
  await importCertificate(cscLink, {
    getTempFile() { throw new Error("Unexpected certificate download or write"); },
  }, currentDir);
  throw new Error("Empty certificate path was unexpectedly accepted");
};
codeSign.findIdentity = async () => null;
const packager = new MacPackager({
  config, metadata, projectDir: process.cwd(),
  buildResourcesDir: path.join(process.cwd(), "build"),
  disposeOnBuildFinish() { throw new Error("Unexpected native keychain cleanup"); },
});
(async () => {
  const allowed = codeSign.isSignAllowed(false);
  if (!allowed) {
    console.log(JSON.stringify({ branch: "pr-skipped", certificateImports }));
    return;
  }
  try {
    const info = await packager.codeSigningInfo.value;
    const identity = await packager.helper.findSigningIdentity(
      false, false, config.mac.identity, info.keychainFile, config.mac,
    );
    console.log(JSON.stringify({
      branch: "signing", identity: identity.name, certificateImports,
      keychainFile: info.keychainFile, hardenedRuntime: config.mac.hardenedRuntime,
      notarize: config.mac.notarize,
    }));
  } catch (error) {
    console.log(JSON.stringify({ branch: "failed", message: error.message, certificateImports }));
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function probe({ pullRequest = false, signingEnv = {} } = {}) {
  // Preserve only OS necessities. In particular, do not inherit local signing
  // credentials, other providers' PR markers, NODE_OPTIONS or CI overrides.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(?:PATH|SystemRoot|SYSTEMROOT|WINDIR|HOME|USERPROFILE|TEMP|TMP|TMPDIR)$/.test(
        key,
      ),
    ),
  );
  const result = spawnSync(process.execPath, ["-e", signingProbe], {
    cwd: desktopRoot,
    encoding: "utf8",
    timeout: 15000,
    env: {
      ...env,
      GITHUB_EVENT_NAME: pullRequest ? "pull_request" : "push",
      GITHUB_REF: pullRequest ? "refs/pull/42/merge" : "refs/heads/main",
      GITHUB_BASE_REF: pullRequest ? "main" : "",
      ...signingEnv,
    },
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  const line = result.stdout.trim().split("\n").at(-1);
  return JSON.parse(line);
}

test("preview packaging omits signing variables while public releases retain their gate", () => {
  const { preview, release } = packagingSteps();
  const inherited = { ...workflow.env, ...packages.env };
  for (const [key, value] of Object.entries({ ...inherited, ...preview.env })) {
    assert.equal(signingVariable.test(key), false, `Preview exports ${key}`);
    assert.doesNotMatch(String(value), /secrets\./);
  }
  assert.doesNotMatch(preview.run, /CSC_|APPLE_|secrets\./);
  assert.match(release.env.CSC_LINK, /secrets\.DESKTOP_CSC_LINK/);
  assert.match(release.env.WIN_CSC_LINK, /secrets\.DESKTOP_WIN_CSC_LINK/);
  const gate = packages.steps.findIndex((step) =>
    /test -n "\$MAC_CERT"/.test(step.run || ""),
  );
  assert.ok(gate >= 0 && gate < packages.steps.indexOf(release));
  assert.equal(packages.steps[gate].if, "inputs.release_version != ''");
  const verification = packages.steps.findIndex((step) =>
    /node scripts\/verify-signing\.mjs/.test(step.run || ""),
  );
  assert.ok(verification > packages.steps.indexOf(release));
  assert.equal(packages.steps[verification].if, "inputs.release_version != ''");
});

test("main preview reaches the builder's ad-hoc identity without certificate import", () => {
  const { preview } = packagingSteps();
  const signingEnv = Object.fromEntries(
    Object.entries({ ...workflow.env, ...packages.env, ...preview.env }).filter(
      ([key]) => signingVariable.test(key),
    ),
  );
  assert.deepEqual(probe({ signingEnv }), {
    branch: "signing",
    identity: "-",
    certificateImports: 0,
    keychainFile: null,
    hardenedRuntime: false,
    notarize: false,
  });
});

test("empty CSC_LINK reproduces the main failure that a PR signing skip conceals", () => {
  const signingEnv = { CSC_LINK: "" };
  const main = probe({ signingEnv });
  assert.equal(main.branch, "failed");
  assert.equal(main.certificateImports, 1);
  assert.match(main.message, /desktop[\\/]? not a file$/);
  assert.deepEqual(probe({ pullRequest: true, signingEnv }), {
    branch: "pr-skipped",
    certificateImports: 0,
  });
});

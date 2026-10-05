import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixMacKeychain } from "../scripts/fix-mac-keychain.mjs";

const require = createRequire(import.meta.url);
const desktopRoot = fileURLToPath(new URL("../", import.meta.url));
const installedPackage = require.resolve("app-builder-lib/package.json");
const installedSource = readFileSync(
  join(dirname(installedPackage), "out/codeSign/macCodeSign.js"),
  "utf8",
);

// Exercise the installed builder and its real file importer in a fresh process.
// Only native security commands are mocked; fake P12 files and a temporary
// directory ensure this never accesses a real certificate or user keychain.
const signingProbe = String.raw`
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const requireDesktop = createRequire(path.join(process.cwd(), "package.json"));
const { installer, rejectPartition } = JSON.parse(process.argv[1]);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "mockinterview-keychain-probe-"));
process.env.APP_BUILDER_TMP_DIR = temp;
// Skip the unrelated bundled root keychain setup, including filesystem writes
// outside our fixture. Native commands still all pass through the mock below.
process.env.TRAVIS = "true";
Object.defineProperty(process, "platform", { value: "darwin" });
requireDesktop("app-builder-lib");
const builderUtil = requireDesktop("builder-util");
const certs = new Map([
  [path.join(temp, "application.p12"), "application-P12-password"],
  ...(installer ? [[path.join(temp, "installer.p12"), "different-installer-P12-password"]] : []),
]);
for (const certificate of certs.keys()) fs.writeFileSync(certificate, "test fixture, not a real certificate");
let keychainPassword;
let keychainFile;
let imports = 0;
let partitions = 0;
let unlocks = 0;
let settings = 0;
let searchListUpdates = 0;
builderUtil.exec = async (file, args) => {
  assert.equal(file, "/usr/bin/security");
  const [command] = args;
  if (command === "delete-keychain") return "";
  if (command === "list-keychains") {
    if (args.length === 3) return '"existing.keychain"\n';
    assert.deepEqual(args, ["list-keychains", "-d", "user", "-s", keychainFile, "existing.keychain"]);
    searchListUpdates++;
    return "";
  }
  if (command === "create-keychain") {
    assert.equal(args[1], "-p");
    keychainPassword = args[2];
    keychainFile = args[3];
    assert.equal(Buffer.from(keychainPassword, "base64").length, 32);
    assert.ok(keychainFile.startsWith(temp + path.sep));
    for (const p12Password of certs.values()) assert.notEqual(keychainPassword, p12Password);
    return "";
  }
  if (command === "unlock-keychain") {
    assert.deepEqual(args, [command, "-p", keychainPassword, keychainFile]);
    unlocks++;
    return "";
  }
  if (command === "set-keychain-settings") {
    assert.deepEqual(args, [command, keychainFile]);
    settings++;
    return "";
  }
  if (command === "import") {
    assert.ok(certs.has(args[1]), "Only fixture certificates may be imported");
    assert.deepEqual(args, [command, args[1], "-k", keychainFile, "-T", "/usr/bin/codesign", "-T", "/usr/bin/productbuild", "-P", certs.get(args[1])]);
    imports++;
    return "";
  }
  if (command === "set-key-partition-list") {
    assert.deepEqual(args, [command, "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]);
    partitions++;
    if (rejectPartition) throw new Error("simulated access control failure");
    return "";
  }
  throw new Error("Unexpected native command: " + command);
};
const codeSign = requireDesktop("app-builder-lib/out/codeSign/macCodeSign");
(async () => {
  try {
    const entries = [...certs.entries()];
    const operation = codeSign.createKeychain({
      tmpDir: { getTempFile() { throw new Error("Unexpected certificate download"); } },
      currentDir: temp,
      cscLink: entries[0][0], cscKeyPassword: entries[0][1],
      ...(installer ? { cscILink: entries[1][0], cscIKeyPassword: entries[1][1] } : {}),
    });
    if (rejectPartition) {
      await assert.rejects(operation, /simulated access control failure/);
      assert.equal(partitions, 1);
    } else {
      assert.deepEqual(await operation, { keychainFile });
      assert.equal(imports, certs.size);
      assert.equal(partitions, certs.size);
    }
    assert.equal(unlocks, 1);
    assert.equal(settings, 1);
    assert.equal(searchListUpdates, 1);
    console.log("verified");
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

function probe(options = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      /^(?:PATH|SystemRoot|SYSTEMROOT|WINDIR|HOME|USERPROFILE|TEMP|TMP|TMPDIR)$/.test(
        key,
      ),
    ),
  );
  const result = spawnSync(
    process.execPath,
    ["-e", signingProbe, JSON.stringify(options)],
    {
      cwd: desktopRoot,
      env,
      encoding: "utf8",
      timeout: 15000,
    },
  );
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.equal(result.stdout.trim(), "verified");
}

test("macOS key access uses the random keychain password while import uses the P12 password", () => {
  probe();
});

test("application and installer certificates keep distinct P12 passwords in one keychain", () => {
  probe({ installer: true });
});

test("native key access failures still reject signing setup", () => {
  probe({ rejectPartition: true });
});

function fixture(t, { version = "26.15.3", source = installedSource } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mockinterview-builder-patch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packagePath = join(root, "package.json");
  const sourcePath = join(root, "out/codeSign/macCodeSign.js");
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(
    packagePath,
    JSON.stringify({ name: "app-builder-lib", version }),
  );
  writeFileSync(sourcePath, source);
  return { packagePath, sourcePath };
}

test("workaround accepts its exact corrected source without rewriting it", (t) => {
  const { packagePath, sourcePath } = fixture(t);
  assert.equal(fixMacKeychain(packagePath), false);
  assert.equal(readFileSync(sourcePath, "utf8"), installedSource);
});

test("workaround rejects a dependency upgrade before changing its source", (t) => {
  const { packagePath, sourcePath } = fixture(t, { version: "26.15.4" });
  assert.throws(
    () => fixMacKeychain(packagePath),
    /Review the macOS keychain workaround/,
  );
  assert.equal(readFileSync(sourcePath, "utf8"), installedSource);
});

test("workaround rejects unknown source even when its version is pinned", (t) => {
  const unknownSource = installedSource + "\n// unexpected change\n";
  const { packagePath, sourcePath } = fixture(t, { source: unknownSource });
  assert.throws(
    () => fixMacKeychain(packagePath),
    /Unrecognized.*refusing to patch/,
  );
  assert.equal(readFileSync(sourcePath, "utf8"), unknownSource);
});

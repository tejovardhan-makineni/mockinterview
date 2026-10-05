import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const expectedVersion = "26.15.3";
const originalHash =
  "9f7d789b326147b6da29e1218d6e3f76b0314c68cf5d0f1efa59338a3c86e71a";
const correctedHash =
  "8fbd9850f6cfc4732d9e103efd2add1c8b5afab5a8163474e2b5fa2e0f9cd792";
const hash = (source) => createHash("sha256").update(source).digest("hex");

// Temporary workaround for the pinned builder: certificate import needs the
// P12 password, but the key's access control needs the generated keychain password.
// Match the complete published file so dependency changes require a fresh review.
export function fixMacKeychain(
  packageJsonPath = require.resolve("app-builder-lib/package.json"),
) {
  const dependency = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (
    dependency.name !== "app-builder-lib" ||
    dependency.version !== expectedVersion
  ) {
    throw new Error(
      "Review the macOS keychain workaround before changing app-builder-lib",
    );
  }
  const target = join(dirname(packageJsonPath), "out/codeSign/macCodeSign.js");
  const source = readFileSync(target, "utf8");
  const sourceHash = hash(source);
  if (sourceHash === correctedHash) return false;
  if (sourceHash !== originalHash) {
    throw new Error(
      "Unrecognized app-builder-lib macOS signing source; refusing to patch",
    );
  }
  const corrected = source
    .replace(
      "return await importCerts(keychainFile, certPaths, cscPasswords);",
      "return await importCerts(keychainFile, keychainPassword, certPaths, cscPasswords);",
    )
    .replace(
      "async function importCerts(keychainFile, paths, keyPasswords) {",
      "async function importCerts(keychainFile, keychainPassword, paths, keyPasswords) {",
    )
    .replace(
      '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
      '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]',
    );
  if (hash(corrected) !== correctedHash) {
    throw new Error("Unexpected macOS keychain correction; refusing to write");
  }
  writeFileSync(target, corrected);
  return true;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  fixMacKeychain();
}

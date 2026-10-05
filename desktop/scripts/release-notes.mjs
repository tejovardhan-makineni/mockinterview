import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  desktopPlatforms,
  parseVersion,
  REPOSITORY,
} from "../../scripts/release-policy.mjs";

export function releaseNotes(manifest) {
  parseVersion(manifest.version);
  const platforms = desktopPlatforms(manifest.target || "all");
  assert(
    manifest.component === "desktop" && manifest.repository === REPOSITORY,
  );
  const lines = [
    `Mock Interview Desktop ${manifest.version} for ${platforms.map((platform) => ({ macos: "macOS (Apple Silicon and Intel)", windows: "Windows x64", linux: "Linux x64" })[platform]).join(", ")}.`,
    "",
    "- Practice with the same interview workspace, profession catalog, custom questions and reports. Interviews and history are saved on your computer.",
    "- A personal AI provider key is required. Cloud providers require internet and may charge your provider account; desktop has no hosted free-interview allowance.",
    "- Sharing preferences are available in Settings. Interview-result sharing requires a separate opt-in and a connected hosted account.",
    "",
    "Download the installer for your operating system from the assets below. `SHA256SUMS.txt` lists the file hashes; `RELEASE-MANIFEST.json` records the source, native CI checks and exact installer bytes.",
    "",
  ];
  if (platforms.includes("macos"))
    lines.push(
      "macOS apps are Developer ID signed and notarized. Choose Apple Silicon (`arm64`) or Intel (`x64`). Open the DMG and drag Mock Interview to Applications.",
      "",
    );
  if (platforms.includes("windows"))
    lines.push(
      "Windows installers and bundled executables have verified, timestamped Authenticode signatures. Run the `windows-x64-setup.exe` installer.",
      "",
    );
  if (platforms.includes("linux"))
    lines.push(
      "Linux: install the `.deb` package on Debian/Ubuntu, or make the `.AppImage` executable and open it on a compatible graphical desktop. A working GNOME Keyring or KWallet is required for encrypted local credentials. Linux packages are checksum-verified; they do not claim an operating-system code signature.",
      "",
    );
  if (platforms.length < 3)
    lines.push(
      "This release contains only the platforms listed above. Other platforms are released separately after their native signing and verification requirements pass.",
      "",
    );
  lines.push(
    "Native packaged-engine startup, local persistence and personal-key boundary checks run in CI. These automated checks do not certify microphone, camera or live-provider quality on every device.",
    "",
    `[Source and desktop documentation](https://github.com/${REPOSITORY}/blob/main/docs/DESKTOP.md). Updates are explicit downloads; no automatic installation is enabled.`,
    "",
  );
  return lines.join("\n");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  assert(
    process.argv.length === 3,
    "Usage: node release-notes.mjs RELEASE-MANIFEST.json",
  );
  process.stdout.write(
    releaseNotes(JSON.parse(await readFile(process.argv[2], "utf8"))),
  );
}

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { desktopPlatforms } from "../../scripts/release-policy.mjs";

const targets = [
  {
    name: "mac-arm64",
    platform: "macos",
    runner: "macos-latest",
    target: "darwin",
    arch: "arm64",
    electron_arch: "arm64",
    package: "mac-arm64",
  },
  {
    name: "mac-x64",
    platform: "macos",
    runner: "macos-15-intel",
    target: "darwin",
    arch: "amd64",
    electron_arch: "x64",
    package: "mac",
  },
  {
    name: "windows-x64",
    platform: "windows",
    runner: "windows-latest",
    target: "windows",
    arch: "amd64",
    electron_arch: "x64",
    package: "win-unpacked",
  },
  {
    name: "linux-x64",
    platform: "linux",
    runner: "ubuntu-latest",
    target: "linux",
    arch: "amd64",
    electron_arch: "x64",
    package: "linux-unpacked",
  },
];

export function buildTargets(target = "all") {
  const platforms = desktopPlatforms(target);
  return {
    include: targets.filter((entry) => platforms.includes(entry.platform)),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const matrix = JSON.stringify(
    buildTargets(process.env.RELEASE_TARGET || "all"),
  );
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `matrix=${matrix}\n`);
  else console.log(matrix);
}

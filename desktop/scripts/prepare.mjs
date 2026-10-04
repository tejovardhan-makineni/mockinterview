import { spawnSync } from "node:child_process";
import { cp, mkdir, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.dirname(desktop);
const desktopPackage = JSON.parse(
  await readFile(path.join(desktop, "package.json"), "utf8"),
);
const sha =
  spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).stdout?.trim() || "";
const resources = path.join(desktop, "resources");
const targetOS =
  process.env.DESKTOP_TARGET_OS ||
  { darwin: "darwin", win32: "windows", linux: "linux" }[process.platform];
const targetArch =
  process.env.DESKTOP_TARGET_ARCH ||
  { x64: "amd64", arm64: "arm64" }[process.arch];
if (
  !["darwin", "windows", "linux"].includes(targetOS) ||
  !["amd64", "arm64"].includes(targetArch)
)
  throw new Error("Unsupported desktop target");

function run(program, args, cwd, env = process.env) {
  const result = spawnSync(program, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: process.platform === "win32" && program === "npm",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Stage in a known generated directory only; no env files, source checkout or
// credentials are included in the app resources.
await rm(resources, { recursive: true, force: true });
await mkdir(path.join(resources, "bin"), { recursive: true });
const webEnvironment = { ...process.env };
for (const key of Object.keys(webEnvironment))
  if (key.startsWith("NEXT_PUBLIC_")) delete webEnvironment[key];
Object.assign(webEnvironment, {
  APP_ENV: "desktop",
  NEXT_PUBLIC_DESKTOP: "1",
  NEXT_PUBLIC_APP_VERSION: desktopPackage.version,
  NEXT_PUBLIC_BUILD_SHA: sha,
  NEXT_PUBLIC_MOCK: "0",
  NEXT_PUBLIC_ANALYTICS_API_BASE:
    "https://mockinterview-api-661893776515.us-west1.run.app",
  NEXT_PUBLIC_API_BASE: "",
});
run("npm", ["run", "build"], path.join(root, "web"), webEnvironment);
run(
  "go",
  [
    "build",
    "-trimpath",
    "-ldflags=-s -w",
    "-o",
    path.join(
      resources,
      "bin",
      targetOS === "windows" ? "mockinterview-api.exe" : "mockinterview-api",
    ),
    "./cmd/mockinterview",
  ],
  path.join(root, "api"),
  { ...process.env, CGO_ENABLED: "0", GOOS: targetOS, GOARCH: targetArch },
);
await cp(path.join(root, "web", "out"), path.join(resources, "web"), {
  recursive: true,
});
for (const folder of ["corpus", "packs", "formats"])
  await cp(
    path.join(root, "api", "data", folder),
    path.join(resources, folder),
    { recursive: true },
  );
await cp(path.join(root, "LICENSE"), path.join(desktop, "LICENSE"));
// Render the existing vector brand mark for native icons. Sharp is already a
// locked dependency of the web build; no separate image tooling is required.
const requireWeb = createRequire(path.join(root, "web", "package.json"));
const sharp = requireWeb("sharp");
await mkdir(path.join(desktop, "build"), { recursive: true });
await sharp(await readFile(path.join(root, "web", "app", "icon.svg")))
  .resize(1024, 1024)
  .png()
  .toFile(path.join(desktop, "build", "icon.png"));
run(
  process.execPath,
  [path.join(desktop, "scripts", "notices.mjs"), resources],
  root,
);
await writeFile(
  path.join(resources, "build.json"),
  JSON.stringify(
    {
      source: sha,
      version: desktopPackage.version,
      platform: targetOS,
      arch: targetArch,
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
await access(path.join(resources, "web", "index.html"));
console.log(`Prepared desktop resources for ${targetOS}/${targetArch}.`);

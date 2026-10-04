import { spawnSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const resources = path.resolve(process.argv[2]);
function go(args) {
  const result = spawnSync("go", args, {
    cwd: path.join(root, "api"),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`Go dependency notice generation failed (${args[0]})`);
  return result.stdout;
}
const entries = go(["list", "-deps", "-json", "./cmd/mockinterview"])
  .trim()
  .split(/\n(?=\{\n)/)
  .map((entry) => JSON.parse(entry));
const modules = new Map();
for (const entry of entries)
  if (entry.Module && !entry.Module.Main)
    modules.set(entry.Module.Path, entry.Module.Replace || entry.Module);
const notices = [
  "Mock Interview Desktop — bundled Go dependency notices",
  "The Electron distribution also includes LICENSE and LICENSES.chromium.html. Web dependency notices are bundled at runtime/web/third-party-notices.txt.",
  "Go standard library\n\n" +
    (await readFile(
      path.join(go(["env", "GOROOT"]).trim(), "LICENSE"),
      "utf8",
    )),
];
for (const module of [...modules.values()].sort((a, b) =>
  a.Path.localeCompare(b.Path),
)) {
  if (!module.Dir)
    throw new Error(`Missing module directory for ${module.Path}`);
  const names = (await readdir(module.Dir)).filter((name) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(name),
  );
  if (!names.length)
    throw new Error(
      `Missing license notice for ${module.Path}; inspect before distributing`,
    );
  for (const name of names.sort()) {
    try {
      notices.push(
        `${module.Path} ${module.Version}\n${name}\n\n${await readFile(path.join(module.Dir, name), "utf8")}`,
      );
    } catch (error) {
      if (error.code !== "EISDIR") throw error;
    }
  }
}
await writeFile(
  path.join(resources, "third-party-go-notices.txt"),
  `${notices.join("\n\n------------------------------------------------------------\n\n")}\n`,
);
console.log(
  `Bundled Go notices for ${modules.size} dependencies and the standard library.`,
);

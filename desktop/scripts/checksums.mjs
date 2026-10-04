import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve(process.argv[2] || "dist");
const names = (await readdir(directory))
  .filter((name) => /\.(dmg|zip|exe|AppImage|deb)$/.test(name))
  .sort();
if (!names.length) throw new Error("No desktop installers found");
const lines = await Promise.all(
  names.map(
    async (name) =>
      `${createHash("sha256")
        .update(await readFile(path.join(directory, name)))
        .digest("hex")}  ${name}`,
  ),
);
await writeFile(
  path.join(directory, "SHA256SUMS.txt"),
  `${lines.join("\n")}\n`,
);
console.log(`Checksummed ${names.length} installers.`);

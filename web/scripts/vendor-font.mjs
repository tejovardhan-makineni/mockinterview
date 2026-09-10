import { createHash } from "node:crypto";
import { cp, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Keep Excalidraw's numeric family 9 and URL while serving the verified OFL font.
export async function installLiberationFont(root, target) {
  const fontRoot = resolve(root, "licenses/liberation-sans-2.1.5");
  const manifest = JSON.parse(
    await readFile(resolve(fontRoot, "source-manifest.json"), "utf8"),
  );
  const editor = JSON.parse(
    await readFile(
      resolve(root, "node_modules/@excalidraw/excalidraw/package.json"),
      "utf8",
    ),
  );
  if (
    `${editor.name}@${editor.version}` !== manifest.replaces.installedPackage
  ) {
    throw new Error(
      "Review the Liberation font replacement for this Excalidraw upgrade",
    );
  }
  const source = resolve(fontRoot, manifest.output.file);
  if (
    createHash("sha256")
      .update(await readFile(source))
      .digest("hex") !== manifest.output.sha256
  ) {
    throw new Error("Liberation font replacement hash mismatch");
  }
  const destination = resolve(
    target,
    "excalidraw/fonts/Liberation/LiberationSans-Regular.woff2",
  );
  await mkdir(dirname(destination), { recursive: true });
  await cp(source, destination);
}

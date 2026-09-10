import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

// Editors never need a third-party CDN. Reproduce these assets from npm's lockfile.
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(root, "public/vendor");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(
  resolve(root, "node_modules/monaco-editor/min/vs"),
  resolve(target, "monaco/vs"),
  { recursive: true },
);
await cp(
  resolve(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"),
  resolve(target, "excalidraw/fonts"),
  { recursive: true },
);

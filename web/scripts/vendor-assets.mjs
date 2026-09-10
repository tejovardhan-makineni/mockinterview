import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { writeNotices } from "./generate-notices.mjs";
import { installLiberationFont } from "./vendor-font.mjs";

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

// Excalidraw's old Liberation 1.05 asset is GPL-font-exception licensed and its
// transformed source provenance is incomplete. Keep family 9 and the URL, but
// serve an official OFL 2.1.5 font with matching ASCII/vertical metrics instead.
await installLiberationFont(root, target);
await writeNotices(root);

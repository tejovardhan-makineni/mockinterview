import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateNotices } from "./generate-notices.mjs";
import { installLiberationFont } from "./vendor-font.mjs";

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "mockinterview-notices-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = {
    "": { name: "fixture" },
    "node_modules/example": { version: "1.0.0", license: "MIT" },
    "node_modules/missing-text": { version: "1.0.0", license: "MIT" },
    "node_modules/dev-only": { version: "1.0.0", dev: true },
    "node_modules/other-platform": { version: "1.0.0", optional: true },
  };
  for (const [path, metadata] of Object.entries(packages)) {
    if (!path || metadata.optional) continue;
    await mkdir(resolve(root, path), { recursive: true });
    await writeFile(
      resolve(root, path, "package.json"),
      JSON.stringify({ name: path.split("/").at(-1), ...metadata }),
    );
  }
  await writeFile(
    resolve(root, "package-lock.json"),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
  await writeFile(
    resolve(root, "node_modules/example/LICENSE"),
    "Actual fixture copyright and permission text.\n",
  );
  await mkdir(resolve(root, "node_modules/example/dist/compiled/component"), {
    recursive: true,
  });
  await writeFile(
    resolve(root, "node_modules/example/dist/compiled/component/NOTICE"),
    "Preserve bundled component attribution.\n",
  );
  return root;
}

test("deterministic notices preserve text, compiled notices and missing-text warnings", async (t) => {
  const root = await fixture(t);
  const first = await generateNotices(root);
  const second = await generateNotices(root);
  assert.equal(first.text, second.text);
  assert.equal(first.packageCount, 2);
  assert.match(first.text, /Actual fixture copyright and permission text\./);
  assert.match(first.text, /Preserve bundled component attribution\./);
  assert.match(first.text, /LICENSE TEXTS REQUIRING MAINTAINER REVIEW/);
  assert.match(first.warnings[0], /missing-text@1\.0\.0/);
  assert.doesNotMatch(first.text, /dev-only@/);
  assert.doesNotMatch(first.text, /other-platform@/);
});

test("upstream supplements are exact-version and hash checked", async (t) => {
  const root = await fixture(t);
  const text = "Upstream copyright retained verbatim.\n";
  await mkdir(resolve(root, "licenses"));
  await writeFile(resolve(root, "licenses/upstream.txt"), text);
  await writeFile(
    resolve(root, "licenses/manifest.json"),
    JSON.stringify({
      supplements: [
        {
          packages: ["missing-text@1.0.0"],
          files: [
            {
              path: "upstream.txt",
              source: "https://example.test/pinned-release/LICENSE",
              sha256: createHash("sha256").update(text).digest("hex"),
            },
          ],
        },
      ],
    }),
  );
  const result = await generateNotices(root);
  assert.equal(result.warnings.length, 0);
  assert.ok(result.text.includes(text.trimEnd()));
  await writeFile(
    resolve(root, "licenses/upstream.txt"),
    "Unexpected replacement",
  );
  await assert.rejects(generateNotices(root), /hash mismatch/);
});

test("incomplete or version-mismatched production installs fail clearly", async (t) => {
  const root = await fixture(t);
  await writeFile(
    resolve(root, "node_modules/example/package.json"),
    JSON.stringify({ name: "example", version: "2.0.0" }),
  );
  await assert.rejects(generateNotices(root), /Installed version differs/);
  await rm(resolve(root, "node_modules/example"), { recursive: true });
  await assert.rejects(
    generateNotices(root),
    /Required production dependency is not installed/,
  );
});

test("real installed browser editors and React retain their license texts", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const result = await generateNotices(root);
  for (const name of ["react", "monaco-editor", "@excalidraw/excalidraw"]) {
    const pkg = JSON.parse(
      await readFile(
        resolve(root, "node_modules", name, "package.json"),
        "utf8",
      ),
    );
    assert.ok(result.text.includes(`${name}@${pkg.version}`));
    assert.ok(
      !result.warnings.some((warning) => warning.startsWith(`${name}@`)),
    );
  }
  for (const path of [
    "react/LICENSE",
    "monaco-editor/LICENSE",
    "monaco-editor/ThirdPartyNotices.txt",
  ]) {
    const text = (await readFile(resolve(root, "node_modules", path), "utf8"))
      .replace(/\r\n?/g, "\n")
      .trimEnd();
    assert.ok(result.text.includes(text), `missing actual ${path}`);
  }
  assert.match(result.text, /Copyright[^\n]*Excalidraw/i);
  const excalidrawLicense = (
    await readFile(resolve(root, "licenses/Excalidraw-0.18.1.txt"), "utf8")
  ).trimEnd();
  assert.ok(
    result.text.includes(excalidrawLicense),
    "missing the complete verified Excalidraw MIT license",
  );
  assert.ok(
    result.warnings.every((warning) =>
      warning.startsWith("@img/sharp-libvips-"),
    ),
    "a browser package needs its missing license text reviewed",
  );
});

test("vendored font preserves the legacy URL and fails on corruption or an editor upgrade", async (t) => {
  const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
  const root = await mkdtemp(
    resolve(tmpdir(), "mockinterview-font-copy-test-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const fontRoot = resolve(root, "licenses/liberation-sans-2.1.5");
  await cp(resolve(sourceRoot, "licenses/liberation-sans-2.1.5"), fontRoot, {
    recursive: true,
  });
  const editorRoot = resolve(root, "node_modules/@excalidraw/excalidraw");
  await mkdir(editorRoot, { recursive: true });
  await cp(
    resolve(sourceRoot, "node_modules/@excalidraw/excalidraw/package.json"),
    resolve(editorRoot, "package.json"),
  );
  const target = resolve(root, "public/vendor");
  await installLiberationFont(root, target);
  const copied = await readFile(
    resolve(target, "excalidraw/fonts/Liberation/LiberationSans-Regular.woff2"),
  );
  const manifest = JSON.parse(
    await readFile(resolve(fontRoot, "source-manifest.json"), "utf8"),
  );
  assert.equal(
    createHash("sha256").update(copied).digest("hex"),
    manifest.output.sha256,
  );
  assert.equal(copied.toString("ascii", 0, 4), "wOF2");
  const original = await readFile(resolve(fontRoot, manifest.output.file));
  await writeFile(resolve(fontRoot, manifest.output.file), "corrupt font");
  await assert.rejects(
    installLiberationFont(root, target),
    /font replacement hash mismatch/,
  );
  assert.deepEqual(
    await readFile(
      resolve(
        target,
        "excalidraw/fonts/Liberation/LiberationSans-Regular.woff2",
      ),
    ),
    copied,
  );
  await writeFile(resolve(fontRoot, manifest.output.file), original);
  await writeFile(
    resolve(editorRoot, "package.json"),
    JSON.stringify({ name: "@excalidraw/excalidraw", version: "9.0.0" }),
  );
  await assert.rejects(
    installLiberationFont(root, target),
    /Review the Liberation font replacement/,
  );
});

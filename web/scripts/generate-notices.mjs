import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const noticeName =
  /(^|[._ -])(licen[sc]e|copying|notice|copyright|ofl)([._ -]|$)|^third[-_ ]?party[-_ ]?notices?/i;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replace(/\r\n?/g, "\n").trimEnd();
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

async function optionalJSON(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function within(root, path) {
  const full = resolve(root, path);
  if (!full.startsWith(resolve(root) + sep)) {
    throw new Error(`Notice path escapes its package: ${path}`);
  }
  return full;
}

async function discoverNotices(root, embeddedComments = false) {
  const found = [];
  async function visit(folder) {
    const entries = (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => compare(a.name, b.name),
    );
    for (const entry of entries) {
      // Nested npm packages are handled by their own lockfile entry. Never
      // follow links into another package or outside the installed graph.
      if (
        entry.isSymbolicLink() ||
        entry.name === "node_modules" ||
        entry.name === ".git"
      )
        continue;
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && noticeName.test(entry.name)) {
        const raw = await readFile(path);
        if (raw.includes(0))
          throw new Error(`Non-text notice requires review: ${path}`);
        const text = normalize(raw.toString("utf8"));
        if (text)
          found.push({
            source: relative(root, path).split(sep).join("/"),
            text,
          });
      } else if (
        entry.isFile() &&
        embeddedComments &&
        /\.(?:m?js|css)$/.test(entry.name)
      ) {
        // Excalidraw embeds notices for bundled components (including font
        // tooling) that are not separate dependencies in its npm manifest.
        const source = await readFile(path, "utf8");
        const comments = source.match(/\/\*[\s\S]*?\*\//g) ?? [];
        for (const [index, comment] of comments.entries()) {
          if (
            /\b(copyright|@license|permission is hereby|licensed under)\b/i.test(
              comment,
            )
          ) {
            found.push({
              source: `${relative(root, path).split(sep).join("/")} legal comment ${index + 1}`,
              text: normalize(comment),
            });
          }
        }
      }
    }
  }
  await visit(root);
  return found;
}

// The output is deliberately broader than a tree-shaken browser bundle: it
// covers installed non-dev lockfile packages, nested compiled notices and the
// editor/font assets copied by vendor-assets. It is not a license compatibility
// determination, and missing texts are explicit rather than fabricated.
export async function generateNotices(webRoot = defaultRoot) {
  const lockText = await readFile(
    resolve(webRoot, "package-lock.json"),
    "utf8",
  );
  const lock = JSON.parse(lockText);
  if (lock.lockfileVersion !== 3 || !lock.packages)
    throw new Error("Expected npm lockfile v3");
  const supplements =
    (await optionalJSON(resolve(webRoot, "licenses/manifest.json")))
      ?.supplements ?? [];
  const packages = new Map();
  const warnings = [];
  let absentOptional = 0;
  for (const [path, locked] of Object.entries(lock.packages).sort(([a], [b]) =>
    compare(a, b),
  )) {
    if (!path || locked.dev) continue;
    if (!path.startsWith("node_modules/"))
      throw new Error(`Unsupported lockfile package path: ${path}`);
    const packageRoot = within(webRoot, path);
    const pkg = await optionalJSON(resolve(packageRoot, "package.json"));
    if (!pkg) {
      if (locked.optional) {
        absentOptional++;
        continue;
      }
      throw new Error(
        `Required production dependency is not installed: ${path}`,
      );
    }
    if (pkg.version !== locked.version)
      throw new Error(
        `Installed version differs from package-lock.json: ${path}`,
      );
    const id = `${pkg.name}@${pkg.version}`;
    if (packages.has(id)) {
      packages.get(id).paths.push(path);
      continue;
    }
    const texts = await discoverNotices(
      packageRoot,
      pkg.name === "@excalidraw/excalidraw",
    );
    for (const supplement of supplements) {
      if (!supplement.packages.includes(id)) continue;
      for (const file of supplement.files) {
        const raw = await readFile(
          within(resolve(webRoot, "licenses"), file.path),
        );
        if (sha256(raw) !== file.sha256)
          throw new Error(`Supplement hash mismatch: ${file.path}`);
        texts.push({
          source: `${file.source}\nPreserved in licenses/${file.path}${supplement.note ? `\nProvenance: ${supplement.note}` : ""}`,
          text: normalize(raw.toString("utf8")),
        });
      }
    }
    // Preserve each distinct text once within the package, retaining all source
    // locations for identical copies (common for compiled runtime variants).
    const unique = new Map();
    for (const item of texts) {
      const digest = sha256(item.text);
      if (unique.has(digest)) unique.get(digest).sources.push(item.source);
      else unique.set(digest, { sources: [item.source], text: item.text });
    }
    const license =
      pkg.license ?? pkg.licenses ?? locked.license ?? "UNDECLARED";
    if (!texts.length)
      warnings.push(
        `${id}: no full license/notice text found; declared license ${typeof license === "string" ? license : JSON.stringify(license)}`,
      );
    packages.set(id, {
      id,
      license,
      paths: [path],
      texts: [...unique.values()],
    });
  }
  const output = [
    "mockinterview — third-party software and asset notices",
    "Generated by scripts/generate-notices.mjs; do not edit this output manually.",
    `package-lock.json SHA-256: ${sha256(lockText)}`,
    "",
    "Scope: installed production npm dependency graph, bundled license sidecars,",
    "and vendored editor/font notices. This conservative inventory includes build",
    "and server packages that are not delivered by the static browser deployment.",
    "In particular, native @img/sharp-libvips libraries are not shipped by this",
    "Firebase static site; their warnings concern other distribution formats.",
    "Dev-only packages are excluded; optional packages unavailable on this build",
    `platform are omitted (${absentOptional}). Regenerate after npm ci on the release platform.`,
    "The notices below retain upstream text. Inclusion is not a claim that every",
    "listed package is shipped, or a legal determination of license compatibility.",
    "",
  ];
  if (warnings.length)
    output.push(
      "LICENSE TEXTS REQUIRING MAINTAINER REVIEW",
      ...warnings.map((warning) => `- ${warning}`),
      "",
    );
  for (const pkg of [...packages.values()].sort((a, b) =>
    compare(a.id, b.id),
  )) {
    output.push(
      "=".repeat(78),
      pkg.id,
      `Declared license: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license)}`,
      `Installed paths: ${pkg.paths.join(", ")}`,
      "",
    );
    if (!pkg.texts.length)
      output.push(
        "LICENSE TEXT NOT INCLUDED IN THE INSTALLED PACKAGE — see review list above.",
        "",
      );
    for (const item of pkg.texts)
      output.push(
        `Source: ${item.sources.join("\n        ")}`,
        "-".repeat(78),
        item.text,
        "",
      );
  }
  return { text: output.join("\n"), warnings, packageCount: packages.size };
}

export async function writeNotices(webRoot = defaultRoot) {
  const result = await generateNotices(webRoot);
  await mkdir(resolve(webRoot, "public"), { recursive: true });
  await writeFile(
    resolve(webRoot, "public/third-party-notices.txt"),
    result.text,
  );
  if (result.warnings.length)
    console.warn(
      `Third-party notices: ${result.warnings.length} packages need license-text review; see public/third-party-notices.txt.`,
    );
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await generateNotices();
  if (process.argv.includes("--check")) {
    if (
      (await readFile(
        resolve(defaultRoot, "public/third-party-notices.txt"),
        "utf8",
      )) !== result.text
    ) {
      throw new Error(
        "Third-party notices are stale; run node scripts/generate-notices.mjs",
      );
    }
  } else {
    await mkdir(resolve(defaultRoot, "public"), { recursive: true });
    await writeFile(
      resolve(defaultRoot, "public/third-party-notices.txt"),
      result.text,
    );
  }
  if (result.warnings.length) {
    console.warn(result.warnings.join("\n"));
    if (process.argv.includes("--strict"))
      throw new Error("Unresolved third-party license texts");
  }
  console.log(
    `Third-party notices: ${result.packageCount} installed production packages.`,
  );
}

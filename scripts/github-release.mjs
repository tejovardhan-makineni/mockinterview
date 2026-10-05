// Trusted-main release coordination. No PR titles/bodies are evaluated as code.
import assert from "node:assert/strict";
import { appendFile, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  REPOSITORY,
  COMPONENTS,
  checksReady,
  componentReleases,
  assertNewVersion,
  desktopPlatforms,
  mergeDesktopManifests,
  installerNames,
  parseVersion,
  compareVersions,
} from "./release-policy.mjs";
import { verifiedDownloadManifest } from "../desktop/scripts/release-assets.mjs";

const repository = process.env.GITHUB_REPOSITORY || REPOSITORY;
assert(repository === REPOSITORY, "Production releases are disabled in forks");
const apiBase = `https://api.github.com/repos/${repository}`;
const token = process.env.GH_TOKEN;
async function api(route, method = "GET", body) {
  const response = await fetch(apiBase + route, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new Error(`GitHub ${method} ${route}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function pages(route) {
  const result = [];
  for (let page = 1; ; page++) {
    const rows = await api(
      `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    result.push(...rows);
    if (rows.length < 100) return result;
  }
}
async function output(key, value) {
  assert(!String(value).includes("\n"), "Multiline output refused");
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  else console.log(`${key}=${value}`);
}
async function publishedDesktopDownloads(releases) {
  const manifests = [];
  for (const release of componentReleases(releases, "desktop")) {
    const asset = release.assets.find(
      (entry) => entry.name === "RELEASE-MANIFEST.json",
    );
    // Legacy drafts/previews without native signing receipts are never linked.
    if (!asset || asset.state !== "uploaded") continue;
    try {
      assert(Number.isSafeInteger(asset.id) && asset.id > 0);
      assert(asset.size > 0 && asset.size <= 64 * 1024);
      const response = await fetch(`${apiBase}/releases/assets/${asset.id}`, {
        headers: {
          Accept: "application/octet-stream",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(30000),
      });
      assert(response.ok, "Could not read release metadata");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length === asset.size && bytes.length <= 64 * 1024);
      assert(
        asset.digest ===
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        "Release metadata checksum mismatch",
      );
      manifests.push(
        verifiedDownloadManifest(release, JSON.parse(bytes.toString("utf8"))),
      );
    } catch (error) {
      console.warn(
        `Skipping unverified desktop release ${release.tag_name}: ${error.message}`,
      );
    }
    if (
      new Set(
        manifests.flatMap((manifest) =>
          manifest.assets.map((entry) => entry.platform),
        ),
      ).size === 3
    )
      break;
  }
  return mergeDesktopManifests(manifests);
}
async function assertMain(sha) {
  assert(/^[a-f0-9]{40}$/.test(sha), "Expected full source commit");
  assert(
    (await api("/git/ref/heads/main")).object.sha === sha,
    "Source is no longer current main; rerun against current main",
  );
}
const command = process.argv[2];
const sha = process.env.RELEASE_SHA || process.env.GITHUB_SHA;
if (command === "gate") {
  const required = process.argv.includes("--required");
  if (
    !required &&
    process.env.GITHUB_EVENT_NAME === "workflow_run" &&
    (await api("/git/ref/heads/main")).object.sha !== sha
  ) {
    await output("ready", "false");
    process.exit(0);
  }
  await assertMain(sha);
  const runs = (
    await api(`/actions/runs?head_sha=${sha}&event=push&per_page=100`)
  ).workflow_runs;
  const ready = checksReady(runs, sha);
  await output("ready", String(ready));
  if (!ready && (required || process.env.GITHUB_EVENT_NAME !== "workflow_run"))
    throw new Error(
      "All main build, test and security workflows must pass before release",
    );
  if (ready) {
    const alerts = await pages(
      "/code-scanning/alerts?state=open&ref=refs%2Fheads%2Fmain",
    );
    assert(alerts.length === 0, "Open CodeQL alerts block production");
  }
} else if (command === "version") {
  const component = process.env.RELEASE_COMPONENT;
  assert(COMPONENTS.includes(component), "Unknown release component");
  if (component === "desktop")
    desktopPlatforms(process.env.RELEASE_TARGET || "all");
  const releases = await pages("/releases");
  const fallback = JSON.parse(
    await readFile(`${component}/package.json`),
  ).version;
  const requested = process.env.RELEASE_VERSION || "";
  if (requested) {
    assertNewVersion(requested, component, releases);
    assert(
      compareVersions(requested, fallback) >= 0,
      "Version is older than the source baseline",
    );
    if (component === "web")
      assert(
        parseVersion(requested)[3] === "stable",
        "Web releases use stable X.Y.Z versions",
      );
    const tagResponse = await fetch(
      `${apiBase}/git/ref/tags/${component}-v${requested}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    assert(
      tagResponse.status === 404,
      "Version tag already exists or could not be checked; never reuse a tag",
    );
  }
  const version =
    requested ||
    componentReleases(releases, component)
      .find((r) => !r.prerelease)
      ?.tag_name.slice(component.length + 2) ||
    fallback;
  await output("version", version);
  await output("tag", `${component}-v${version}`);
  const manifest = await publishedDesktopDownloads(releases);
  await output("desktop_manifest", manifest ? JSON.stringify(manifest) : "");
} else if (command === "current") {
  await assertMain(sha);
} else if (command === "create-tag") {
  const component = process.env.RELEASE_COMPONENT;
  assert(COMPONENTS.includes(component), "Unknown release component");
  parseVersion(process.env.RELEASE_VERSION);
  await api("/git/refs", "POST", {
    ref: `refs/tags/${component}-v${process.env.RELEASE_VERSION}`,
    sha,
  });
} else if (command === "verify-tag") {
  const component = process.env.RELEASE_COMPONENT;
  assert(COMPONENTS.includes(component), "Unknown release component");
  parseVersion(process.env.RELEASE_VERSION);
  let object = (
    await api(`/git/ref/tags/${component}-v${process.env.RELEASE_VERSION}`)
  ).object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++)
    object = (await api(`/git/tags/${object.sha}`)).object;
  assert(
    object.type === "commit" && object.sha === sha,
    "Release tag does not point to the tested source commit",
  );
} else if (command === "verify-assets") {
  const release = (await pages("/releases")).find(
    (r) => r.tag_name === `desktop-v${process.env.RELEASE_VERSION}`,
  );
  assert(release, "Release draft not found");
  for (const name of await readdir("release-assets")) {
    const bytes = await readFile(path.join("release-assets", name));
    const asset = release.assets.find((a) => a.name === name);
    assert(
      asset?.state === "uploaded" &&
        asset.size === bytes.length &&
        asset.digest ===
          `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      `Remote asset mismatch: ${name}`,
    );
  }
  for (const name of installerNames(
    process.env.RELEASE_VERSION,
    process.env.RELEASE_TARGET || "all",
  ))
    assert(
      release.assets.some((a) => a.name === name),
      `Missing installer ${name}`,
    );
  assert(release.draft, "Refusing to mutate published release");
  await writeFile(
    "verified-release.json",
    JSON.stringify(
      { id: release.id, tag: release.tag_name, source: sha },
      null,
      2,
    ),
  );
} else throw new Error("Unknown release command");

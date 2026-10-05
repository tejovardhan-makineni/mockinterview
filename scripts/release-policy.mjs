import assert from "node:assert/strict";

export const REPOSITORY = "tejovardhan-makineni/mockinterview";
export const REQUIRED_WORKFLOWS = [
  "ci.yml",
  "security.yml",
  "desktop-build.yml",
];
export const COMPONENTS = ["web", "desktop"];

export function parseVersion(value) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/.exec(
      value,
    );
  assert(
    match && match[0] === value && value.length <= 64,
    "Use X.Y.Z or X.Y.Z-beta.N (alpha/rc also supported)",
  );
  return [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    match[4] || "stable",
    Number(match[5] || 0),
  ];
}

export function compareVersions(a, b) {
  const left = parseVersion(a),
    right = parseVersion(b);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] - right[i];
  const order = { alpha: 0, beta: 1, rc: 2, stable: 3 };
  return order[left[3]] - order[right[3]] || left[4] - right[4];
}

export function componentReleases(releases, component) {
  assert(COMPONENTS.includes(component), "Unknown release component");
  return releases
    .filter((r) => {
      if (r.draft || !r.tag_name.startsWith(`${component}-v`)) return false;
      try {
        parseVersion(r.tag_name.slice(component.length + 2));
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) =>
      compareVersions(
        b.tag_name.slice(component.length + 2),
        a.tag_name.slice(component.length + 2),
      ),
    );
}

export function assertNewVersion(version, component, releases) {
  parseVersion(version);
  const previous = componentReleases(releases, component)[0];
  if (previous)
    assert(
      compareVersions(version, previous.tag_name.slice(component.length + 2)) >
        0,
      `Version must be newer than ${previous.tag_name}`,
    );
  assert(
    !releases.some((r) => r.tag_name === `${component}-v${version}`),
    "Release already exists (including drafts)",
  );
}

export function checksReady(runs, sha) {
  return REQUIRED_WORKFLOWS.every((file) => {
    const matching = runs
      .filter(
        (r) =>
          r.head_sha === sha &&
          r.event === "push" &&
          r.head_branch === "main" &&
          r.path === `.github/workflows/${file}`,
      )
      .sort((a, b) => b.id - a.id);
    return (
      matching[0]?.status === "completed" &&
      matching[0]?.conclusion === "success"
    );
  });
}

export function desktopPlatforms(target = "all") {
  assert(
    ["all", "macos", "windows", "linux"].includes(target),
    "Desktop target must be all, macos, windows or linux",
  );
  return target === "all" ? ["macos", "windows", "linux"] : [target];
}

export function installerNames(version, target = "all") {
  parseVersion(version);
  const platforms = desktopPlatforms(target);
  return [
    `MockInterview-${version}-mac-arm64.dmg`,
    `MockInterview-${version}-mac-arm64.zip`,
    `MockInterview-${version}-mac-x64.dmg`,
    `MockInterview-${version}-mac-x64.zip`,
    `MockInterview-${version}-windows-x64-setup.exe`,
    `MockInterview-${version}-linux-x86_64.AppImage`,
    `MockInterview-${version}-linux-amd64.deb`,
  ].filter((name) => platforms.includes(installerPlatform(name)));
}

function installerPlatform(name) {
  return name.includes("-mac-")
    ? "macos"
    : name.includes("-windows-")
      ? "windows"
      : "linux";
}

export function desktopManifest(release, metadata) {
  assert(!release.draft, "Only public desktop releases are advertised");
  assert(release.tag_name.startsWith("desktop-v"), "Expected desktop release");
  const version = release.tag_name.slice(9);
  const required = installerNames(version, metadata?.target || "all");
  assert(
    metadata?.schemaVersion === 1 &&
      metadata.component === "desktop" &&
      metadata.version === version &&
      metadata.repository === REPOSITORY &&
      /^[a-f0-9]{40}$/.test(metadata.sourceSha || "") &&
      metadata.verification?.checksums === "verified" &&
      metadata.verification?.provenance === "same-run-native-CI-receipts" &&
      Array.isArray(metadata.files) &&
      metadata.files.length === required.length,
    "Missing verified desktop release metadata",
  );
  assert(
    release.assets.some(
      (a) => a.name === "RELEASE-MANIFEST.json" && a.state === "uploaded",
    ),
    "Missing verified release metadata",
  );
  for (const name of required) {
    const asset = release.assets.find((a) => a.name === name);
    const files = metadata.files.filter((file) => file.name === name);
    const file = files[0];
    assert(
      files.length === 1 &&
        asset?.state === "uploaded" &&
        /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
        asset.size > 0 &&
        asset.digest === `sha256:${file.sha256}` &&
        asset.size === file.bytes &&
        file.platform === installerPlatform(name),
      `Missing verified installer: ${name}`,
    );
    const signing = file.signing;
    assert(
      file.platform === "linux"
        ? signing?.status === "not-applicable" && signing.method === "none"
        : signing?.status === "verified" &&
            signing.method ===
              (file.platform === "macos"
                ? "developer-id-and-notarization"
                : "authenticode"),
      `Installer signing was not verified: ${name}`,
    );
  }
  return {
    tag: release.tag_name,
    prerelease: Boolean(release.prerelease),
    assets: required
      .filter((n) => !n.endsWith(".zip"))
      .map((name) => ({
        platform: name.includes("-mac-")
          ? "mac"
          : name.includes("-windows-")
            ? "windows"
            : "linux",
        label: name.includes("-mac-arm64")
          ? "Apple Silicon"
          : name.includes("-mac-x64")
            ? "Intel Mac"
            : name.endsWith(".exe")
              ? "Windows x64"
              : name.endsWith(".deb")
                ? "Debian / Ubuntu"
                : "Linux AppImage",
        url: `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`,
      })),
  };
}

/** Input is newest first, and every manifest has already passed verification. */
export function mergeDesktopManifests(manifests) {
  if (!manifests.length) return null;
  const platforms = new Set();
  const assets = [];
  for (const manifest of manifests) {
    const selected = manifest.assets.filter(
      (asset) => !platforms.has(asset.platform),
    );
    for (const asset of selected) {
      assets.push({
        ...asset,
        tag: manifest.tag,
        prerelease: manifest.prerelease,
      });
      platforms.add(asset.platform);
    }
  }
  return { tag: manifests[0].tag, prerelease: manifests[0].prerelease, assets };
}

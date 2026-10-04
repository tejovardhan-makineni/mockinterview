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

export function installerNames(version) {
  parseVersion(version);
  return [
    `MockInterview-${version}-mac-arm64.dmg`,
    `MockInterview-${version}-mac-arm64.zip`,
    `MockInterview-${version}-mac-x64.dmg`,
    `MockInterview-${version}-mac-x64.zip`,
    `MockInterview-${version}-windows-x64-setup.exe`,
    `MockInterview-${version}-linux-x86_64.AppImage`,
    `MockInterview-${version}-linux-amd64.deb`,
  ];
}

export function desktopManifest(release) {
  assert(
    !release.draft && !release.prerelease,
    "Only public stable desktop releases are advertised",
  );
  assert(release.tag_name.startsWith("desktop-v"), "Expected desktop release");
  const version = release.tag_name.slice(9);
  const required = installerNames(version);
  assert(
    release.assets.some(
      (a) => a.name === "RELEASE-MANIFEST.json" && a.state === "uploaded",
    ),
    "Missing verified release metadata",
  );
  for (const name of required) {
    const asset = release.assets.find((a) => a.name === name);
    assert(
      asset?.state === "uploaded" &&
        /^sha256:[a-f0-9]{64}$/.test(asset.digest) &&
        asset.size > 0,
      `Missing verified installer: ${name}`,
    );
  }
  return {
    tag: release.tag_name,
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

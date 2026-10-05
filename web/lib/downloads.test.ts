import { describe, expect, it } from "vitest";
import { parseDesktopRelease, RELEASES_URL } from "./downloads";
const release = {
  tag: "desktop-v0.1.0-beta.1",
  assets: [
    {
      platform: "mac",
      label: "Apple Silicon",
      url:
        RELEASES_URL +
        "/download/desktop-v0.1.0-beta.1/mockinterview-arm64.dmg",
    },
  ],
};
describe("verified desktop release manifest", () => {
  it("keeps unavailable downloads unavailable without a release manifest", () => {
    expect(parseDesktopRelease(undefined)).toBeNull();
    expect(parseDesktopRelease("{}")).toBeNull();
  });
  it("accepts specific assets on this project's versioned GitHub release", () => {
    expect(parseDesktopRelease(JSON.stringify(release))).toEqual(release);
  });
  it("accepts verified beta labels and previous-platform release links", () => {
    const value = {
      ...release,
      tag: "desktop-v0.1.0-beta.2",
      prerelease: true,
      assets: release.assets.map((asset) => ({
        ...asset,
        tag: release.tag,
        prerelease: true,
      })),
    };
    expect(parseDesktopRelease(JSON.stringify(value))).toEqual(value);
  });
  it("rejects incorrect platform extensions or untrusted per-asset tags", () => {
    for (const patch of [
      { platform: "windows" },
      { tag: "../other" },
      { prerelease: "true" },
    ]) {
      expect(
        parseDesktopRelease(
          JSON.stringify({
            ...release,
            assets: [{ ...release.assets[0], ...patch }],
          }),
        ),
      ).toBeNull();
    }
  });
  it.each([
    "https://evil.example/malware.exe",
    RELEASES_URL + "/latest/download/app.dmg",
    release.assets[0].url + "?redirect=evil",
    RELEASES_URL + "/download/desktop-v0.1.0-beta.1/../app.dmg",
  ])("rejects unverified destination %s", (url) => {
    expect(
      parseDesktopRelease(
        JSON.stringify({ ...release, assets: [{ ...release.assets[0], url }] }),
      ),
    ).toBeNull();
  });
});

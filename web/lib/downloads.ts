import { SOURCE_URL } from "./project";

export const RELEASES_URL = SOURCE_URL + "/releases";
export interface DesktopRelease {
  tag: string;
  prerelease?: boolean;
  assets: {
    label: string;
    platform: "mac" | "windows" | "linux";
    url: string;
    tag?: string;
    prerelease?: boolean;
  }[];
}
/** Release automation sets this only after published assets have been verified. */
export function parseDesktopRelease(
  value: string | undefined,
): DesktopRelease | null {
  if (!value) return null;
  try {
    const release = JSON.parse(value) as DesktopRelease;
    if (
      !/^(?:desktop-)?v[0-9][a-zA-Z0-9._-]{0,80}$/.test(release.tag) ||
      (release.prerelease !== undefined &&
        typeof release.prerelease !== "boolean") ||
      !Array.isArray(release.assets) ||
      release.assets.length < 1 ||
      release.assets.length > 12
    )
      return null;
    const seen = new Set<string>();
    for (const asset of release.assets) {
      const tag = asset.tag || release.tag;
      const prefix = `${SOURCE_URL}/releases/download/${tag}/`;
      if (
        !/^(?:desktop-)?v[0-9][a-zA-Z0-9._-]{0,80}$/.test(tag) ||
        (asset.prerelease !== undefined &&
          typeof asset.prerelease !== "boolean") ||
        !["mac", "windows", "linux"].includes(asset.platform) ||
        typeof asset.label !== "string" ||
        asset.label.length > 100 ||
        !asset.label.trim() ||
        typeof asset.url !== "string" ||
        !asset.url.startsWith(prefix)
      )
        return null;
      const filename = asset.url.slice(prefix.length);
      if (
        (asset.platform === "mac" && !filename.endsWith(".dmg")) ||
        (asset.platform === "windows" && !filename.endsWith(".exe")) ||
        (asset.platform === "linux" && !/\.(AppImage|deb)$/.test(filename))
      )
        return null;
      if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(dmg|exe|AppImage|deb)$/.test(
          filename,
        ) ||
        seen.has(asset.url)
      )
        return null;
      seen.add(asset.url);
    }
    return release;
  } catch {
    return null;
  }
}
export const DESKTOP_RELEASE = parseDesktopRelease(
  process.env.NEXT_PUBLIC_DESKTOP_RELEASE,
);

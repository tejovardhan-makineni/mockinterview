import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { version as webVersion } from "../package.json";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_DESKTOP", "0");
  vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "");
  vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("release labels", () => {
  it("uses the web package fallback without inventing build metadata", async () => {
    const { AppVersion } = await import("../components/AppVersion");
    expect(renderToStaticMarkup(<AppVersion showBuild />)).toBe(
      `<span>Web v${webVersion}</span>`,
    );
  });

  it("uses the independently injected desktop version and separates its short build ID", async () => {
    const desktopVersion = "4.5.6-beta.2";
    vi.stubEnv("NEXT_PUBLIC_DESKTOP", "1");
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", desktopVersion);
    vi.stubEnv(
      "NEXT_PUBLIC_BUILD_SHA",
      "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    );
    const { AppVersion } = await import("../components/AppVersion");
    const html = renderToStaticMarkup(<AppVersion showBuild />);
    expect(html).toContain(`Desktop v${desktopVersion}`);
    expect(html).toContain('title="Build abcdef1"');
    expect(html).toContain("build <code>abcdef1</code>");
    expect(renderToStaticMarkup(<AppVersion />)).not.toContain("<code>");
  });

  it("honors the published web release version while rejecting a malformed build identifier", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "1.2.3");
    vi.stubEnv("NEXT_PUBLIC_BUILD_SHA", "not-a-source-commit");
    const { AppVersion } = await import("../components/AppVersion");
    expect(renderToStaticMarkup(<AppVersion showBuild />)).toBe(
      "<span>Web v1.2.3</span>",
    );
  });
});

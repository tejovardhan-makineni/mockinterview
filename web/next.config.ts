import type { NextConfig } from "next";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import webPackage from "./package.json";

const packageVersion =
  process.env.NEXT_PUBLIC_DESKTOP === "1"
    ? process.env.NEXT_PUBLIC_APP_VERSION ||
      JSON.parse(
        readFileSync(
          path.resolve(process.cwd(), "../desktop/package.json"),
          "utf8",
        ),
      ).version
    : webPackage.version;
let buildSHA = process.env.NEXT_PUBLIC_BUILD_SHA || "";
if (!buildSHA) {
  try {
    buildSHA = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // A source archive can be built without Git metadata.
  }
}

// Deployment must opt into this guard; a local static demo remains possible.
if (
  process.env.NEXT_PUBLIC_DESKTOP === "1" &&
  process.env.NEXT_PUBLIC_MOCK === "1"
)
  throw new Error("Desktop packages require the real local API.");
if (
  process.env.APP_ENV === "production" &&
  process.env.NEXT_PUBLIC_DESKTOP !== "1"
) {
  if (process.env.NEXT_PUBLIC_MOCK === "1")
    throw new Error("Production cannot use simulated interviews.");
  const origin = new URL(
    process.env.NEXT_PUBLIC_API_BASE || "http://localhost",
  );
  if (
    origin.protocol !== "https:" ||
    /^(localhost|127\.|\[::1\])/.test(origin.hostname)
  ) {
    throw new Error(
      "Production requires NEXT_PUBLIC_API_BASE with the HTTPS API origin.",
    );
  }
}

// Static export → Firebase Hosting (matches the house convention). The app talks
// to the Go API purely over HTTP at NEXT_PUBLIC_API_BASE, so there is no server
// runtime to host. In mock mode (NEXT_PUBLIC_MOCK=1) it needs no backend at all.
const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION || packageVersion,
    NEXT_PUBLIC_BUILD_SHA: /^[a-f0-9]{7,40}$/i.test(buildSHA) ? buildSHA : "",
  },
  agentRules: false,
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

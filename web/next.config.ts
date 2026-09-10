import type { NextConfig } from "next";

// Deployment must opt into this guard; a local static demo remains possible.
if (process.env.APP_ENV === "production") {
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
  agentRules: false,
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

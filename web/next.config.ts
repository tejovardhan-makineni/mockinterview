import type { NextConfig } from "next";

// Static export → Firebase Hosting (matches the house convention). The app talks
// to the Go API purely over HTTP at NEXT_PUBLIC_API_BASE, so there is no server
// runtime to host. In mock mode (NEXT_PUBLIC_MOCK=1) it needs no backend at all.
const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Let phones on the home Wi-Fi open the dev server (local network addresses only).
  allowedDevOrigins: ["192.168.*.*"],
  partialPrefetching: true,
  // Which deploy this page came from, so an app left open in the background
  // can tell when a newer one is live (components/FreshVersion.tsx).
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
};

export default nextConfig;

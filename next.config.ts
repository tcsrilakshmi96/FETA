import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Let phones on the home Wi-Fi open the dev server (local network addresses only).
  allowedDevOrigins: ["192.168.*.*"],
  partialPrefetching: true,
};

export default nextConfig;

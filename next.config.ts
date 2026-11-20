import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Let phones on the home Wi-Fi open the dev server (local network addresses only).
  allowedDevOrigins: ["192.168.*.*"],
  partialPrefetching: true,
  // Which deploy this page came from, so an app left open in the background
  // can tell when a newer one is live (components/FreshVersion.tsx).
  env: { NEXT_PUBLIC_BUILD: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev" },
  // Basic browser protections (Round 5 review). Location only for Feta
  // itself, no camera or microphone, and no other site may frame Feta.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=()" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;

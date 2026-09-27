import type { NextConfig } from "next";

// Covers are served as signed URLs from the project's Supabase Storage host.
// Derived from the public env var rather than hard-coded so preview/production
// projects work without edits.
const supabaseHost = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/**" }]
      : [],
  },
  // Dev-only: let the phone (and other LAN devices) load /_next/* dev assets +
  // HMR when hitting the Network URL. No effect on production builds.
  allowedDevOrigins: ["192.168.88.16"],
  // Offline service worker (src/lib/offline/service-worker.ts) versions its
  // caches by build id so a deploy drops stale cached shells. Vercel sets
  // VERCEL_GIT_COMMIT_SHA; fall back to a timestamp for local builds.
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA ?? String(Date.now()),
  },
};

export default nextConfig;

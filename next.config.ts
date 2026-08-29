import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dev-only: let the phone (and other LAN devices) load /_next/* dev assets +
  // HMR when hitting the Network URL. No effect on production builds.
  allowedDevOrigins: ["192.168.88.16"],
};

export default nextConfig;

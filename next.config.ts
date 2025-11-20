import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      // si usas el dominio nuevo de buckets:
      { protocol: "https", hostname: "foot-selfie---multiplatform.firebasestorage.app" },
    ],
  },
};

export default nextConfig;

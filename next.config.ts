import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Spotify CDN (ジャケット画像) と Google avatar
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;

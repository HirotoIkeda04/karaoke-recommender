import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Spotify CDN / iTunes (Apple Music) artwork CDN / Google avatar
    remotePatterns: [
      { protocol: "https", hostname: "i.scdn.co" },
      { protocol: "https", hostname: "is1-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is2-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is3-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is4-ssl.mzstatic.com" },
      { protocol: "https", hostname: "is5-ssl.mzstatic.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
};

export default nextConfig;

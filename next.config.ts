import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare (kyokumoku.ihiro.page) へ移行済み。旧 URL へのアクセスはパスを保ったまま転送する。
  // 切替後 48 時間のロールバック猶予の間は一時リダイレクト (307)。問題なければ permanent: true (308) に変える。
  async redirects() {
    return [
      {
        source: "/:path*",
        destination: "https://kyokumoku.ihiro.page/:path*",
        permanent: false,
      },
    ];
  },
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

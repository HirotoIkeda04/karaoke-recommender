import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Noto_Serif_JP } from "next/font/google";

import { ServiceWorkerRegister } from "@/components/sw-register";

import "./globals.css";

// iOS 実機では globals.css の --font-sans 先頭にある -apple-system が
// そのまま SF Pro に解決されるので、この Inter は Android / Windows /
// Linux 用の SF Pro 代替 (メトリクスが近い一般的なフォント) として
// フォールバックチェーンの 2 番目に入る。
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSerifJp = Noto_Serif_JP({
  variable: "--font-noto-serif-jp",
  subsets: ["latin"],
  weight: ["500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "KyokuMoku",
  description: "音域ベースのカラオケ楽曲評価アプリ",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "KyokuMoku",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#121212",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`dark ${inter.variable} ${geistMono.variable} ${notoSerifJp.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

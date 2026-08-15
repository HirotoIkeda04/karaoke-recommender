import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";

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

// 明朝 (プロフィールの表示名) は next/font/google から外し、globals.css の
// --font-serif-jp (端末の明朝) に任せている。
//
// 理由: Noto Serif JP は日本語の unicode-range サブセットが 1 ウェイトあたり
// 120 個あり、2 ウェイトで 1 ビルド 240 リクエストを fonts.gstatic.com に
// 投げる。2026-08-15 の Vercel (iad1) ビルドで、このうち 124 件が 404 を返して
// ビルドが落ちた (レート制限とみられる。ローカルでは再現しない)。
// 表示名 1 箇所のためにビルドを外部サービスの機嫌に依存させる価値はない。
// iOS/macOS には Hiragino Mincho ProN が標準で載っているので、
// システムフォント優先という全体方針とも一致する。

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
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}

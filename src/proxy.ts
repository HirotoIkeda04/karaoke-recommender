import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// 未ログインでも開けるパス:
// - /friend/[token]:   招待リンク着地ページ
// - /r/[qrToken]:      QR スキャン着地ページ (ゲスト参加可)
// - /opengraph-image:  SNS クローラ用 OG 画像 (Next.js 動的ルート)
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/friend",
  "/r",
  "/opengraph-image",
  // Liquid Glass 移行検討用の参照モック。デプロイ環境では下で 404 にするため
  // 実質ローカル dev 限定だが、dev ではログイン不要にしておく。
  "/liquid-glass",
] as const;

// ゲスト (未ログイン) に開放するアプリ本体のパス。
//
// ここに並ぶページは「ゲスト公開 70 曲 (src/data/guest-songs.json) の範囲で
// 動く」ように作ってある。ゲストは Supabase を一切叩かず、評価は
// localStorage に入る。だから anon 向けに RLS / GRANT を開ける必要が無い。
//
// ここに新しいパスを足す時は、そのページがゲスト (user = null) で
// 破綻しないことを必ず確認すること。ルーム / フレンド / ランキング /
// アーティスト / プロフィール / 設定は他人のデータや全曲カタログを
// 前提にしているので、ログイン必須のままにしてある。
const GUEST_PATHS = [
  "/", // ホーム (レコードデッキ)
  "/songs", // 検索と曲詳細
  "/library", // ライブラリ (localStorage 由来)
] as const;

const UNAUTHENTICATED_PATHS = [...PUBLIC_PATHS, ...GUEST_PATHS];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /liquid-glass は段階移行用の参照モック。コードは温存しつつ、
  // デプロイ環境 (Vercel prod/preview, next start) では非表示にする。
  // NODE_ENV はローカル `next dev` のみ "development"。
  if (
    process.env.NODE_ENV === "production" &&
    (pathname === "/liquid-glass" || pathname.startsWith("/liquid-glass/"))
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return updateSession(request, UNAUTHENTICATED_PATHS);
}

export const config = {
  // _next/static, _next/image, favicon, manifest, 画像系は素通り (パフォーマンス)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

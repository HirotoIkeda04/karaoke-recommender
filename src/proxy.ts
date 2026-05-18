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

  return updateSession(request, PUBLIC_PATHS);
}

export const config = {
  // _next/static, _next/image, favicon, manifest, 画像系は素通り (パフォーマンス)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

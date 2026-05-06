import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// 未ログインでも開けるパス:
// - /friend/[token]: 招待リンク着地ページ
// - /r/[qrToken]:    QR スキャン着地ページ (ゲスト参加可)
const PUBLIC_PATHS = ["/login", "/auth", "/friend", "/r"] as const;

export async function proxy(request: NextRequest) {
  return updateSession(request, PUBLIC_PATHS);
}

export const config = {
  // _next/static, _next/image, favicon, manifest, 画像系は素通り (パフォーマンス)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

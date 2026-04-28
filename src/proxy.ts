import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

// /friend/[token] は未ログインでも開ける (招待リンク着地ページのため)
// 「ログインしてフレンドになる」ボタンから login → callback → 戻ってきて承諾の流れ
const PUBLIC_PATHS = ["/login", "/auth", "/friend"] as const;

export async function proxy(request: NextRequest) {
  return updateSession(request, PUBLIC_PATHS);
}

export const config = {
  // _next/static, _next/image, favicon, 画像系は素通り (パフォーマンス)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

const PUBLIC_PATHS = ["/login", "/auth"] as const;

export async function middleware(request: NextRequest) {
  return updateSession(request, PUBLIC_PATHS);
}

export const config = {
  // _next/static, _next/image, favicon, 画像系は素通り (パフォーマンス)
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

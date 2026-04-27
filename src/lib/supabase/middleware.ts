import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

/**
 * Supabase の auth Cookie をリフレッシュし、必要ならログイン画面へリダイレクトする。
 * 各リクエストで一度だけ呼ぶ (middleware から)。
 *
 * @param publicPaths 認証不要のパス prefix。一致したら未ログインでも素通り。
 */
export async function updateSession(
  request: NextRequest,
  publicPaths: readonly string[],
) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // パフォーマンス最適化: routing 判定だけならネット往復なしの getSession で十分。
  // (getUser は Supabase サーバーで JWT 検証する分 150-300ms の往復が加わる)
  // セキュリティ: revoke 後も JWT 有効期限 (default 1h) 中は通るが、
  //   - 書き込み系 server action は getUser を使う
  //   - データアクセスは RLS が JWT 署名から auth.uid() を取得して防御
  // 個人+友人レベルではこの程度のラグは許容範囲。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  const pathname = request.nextUrl.pathname;
  const isPublic = publicPaths.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

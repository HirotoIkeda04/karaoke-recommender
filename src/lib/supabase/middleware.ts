import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

/**
 * Supabase の auth Cookie 名。チャンク分割されると `.0` `.1` が付く。
 * OAuth 途中の `-auth-token-code-verifier` は「ログイン済みだった印」では
 * ないので、末尾一致で弾いてある。
 */
const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * middleware 側でセッションを前倒しリフレッシュする余裕 (ms)。
 *
 * auth-js は「期限まで 90 秒を切ったら getSession() でリフレッシュする」
 * ので、middleware で 91 秒残っていたセッションが、その直後に走る Server
 * Component の getSession() では 89 秒になってリフレッシュ対象になり得る。
 * Server Component は Cookie を書けない (server.ts の setAll は例外を握り
 * つぶす) ため、そこでリフレッシュが起きると回転後の refresh token が
 * ブラウザに届かないまま消える。次のリクエストは使用済みトークンを送る
 * ことになり、Supabase に拒否されて「勝手にログアウト」になる。
 *
 * middleware の余裕を auth-js より十分広く取り、Server Component へ渡る
 * 時点では必ず余裕が残っているようにしてこの窓を塞ぐ。リフレッシュの
 * 回数は増えない (期限の 5 分前に前倒しされるだけ)。
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * リダイレクトを返す時も、このリクエスト中に更新された auth Cookie を
 * 必ず持たせる。
 *
 * NextResponse.redirect() は新しいレスポンスなので、そのまま返すと
 * リフレッシュで発行された Cookie (と、失敗時の削除 Cookie) が落ちる。
 * 落とすとブラウザには回転前の refresh token が残り、それはサーバー側で
 * 既に使用済みなので、次のリフレッシュが弾かれてログアウトになる。
 */
function redirectPreservingCookies(
  response: NextResponse,
  url: URL,
): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) {
    redirect.cookies.set(cookie);
  }
  return redirect;
}

function loginUrl(request: NextRequest, pathname: string): URL {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", pathname);
  return url;
}

/**
 * Supabase の auth Cookie をリフレッシュし、必要ならログイン画面へリダイレクトする。
 * 各リクエストで一度だけ呼ぶ (middleware から)。
 *
 * @param publicPaths 認証と無関係に開くパス prefix (ログイン / 招待リンク等)。
 * @param guestPaths  未ログインでも「ゲストとして」開くアプリ本体のパス。
 */
export async function updateSession(
  request: NextRequest,
  {
    publicPaths,
    guestPaths,
  }: { publicPaths: readonly string[]; guestPaths: readonly string[] },
) {
  let response = NextResponse.next({ request });

  // getSession() より前に控えておく。リフレッシュに失敗すると auth-js が
  // セッションを消しに行き、その削除が request.cookies にも空値で反映される
  // ので、後からでは「元々ログインしていたのか、最初からゲストだったのか」
  // を見分けられなくなる。
  const hadAuthCookie = request.cookies
    .getAll()
    .some(({ name, value }) => AUTH_COOKIE_RE.test(name) && value !== "");

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
  let user = session?.user ?? null;

  // Server Component がリフレッシュ役になってしまう窓を塞ぐ (上の
  // REFRESH_MARGIN_MS 参照)。Cookie を書けるのはここだけなので、期限が
  // 近いセッションはここで回しておく。
  if (
    user &&
    session?.expires_at &&
    session.expires_at * 1000 - Date.now() < REFRESH_MARGIN_MS
  ) {
    const { data } = await supabase.auth.refreshSession();
    user = data.session?.user ?? user;
  }

  const pathname = request.nextUrl.pathname;
  const matches = (paths: readonly string[]) =>
    paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isPublic = matches(publicPaths);
  const isGuestPath = matches(guestPaths);

  if (!user && !isPublic && !isGuestPath) {
    return redirectPreservingCookies(response, loginUrl(request, pathname));
  }

  // ゲストに開放しているページでも、ログイン済みだった人のセッションが
  // 落ちた時は黙ってゲストとして描かない。描いてしまうと本人には「勝手に
  // ログアウトされた」ようにしか見えず、しかも評価の保存先が localStorage
  // に変わって DB に残らなくなる。期限切れだと分かる形でログインへ送る。
  if (!user && isGuestPath && hadAuthCookie) {
    const url = loginUrl(request, pathname);
    url.searchParams.set(
      "error",
      "セッションの有効期限が切れました。もう一度サインインしてください",
    );
    // 「Cookie は届いていたが使えなかった」ことをログイン画面へ伝える。
    // ここを通る時点で auth-js が削除 Cookie を積んでいるので、画面側から
    // Cookie の有無を見ても判定できない (src/lib/auth-session-trace.ts)。
    url.searchParams.set("reason", "stale-cookie");
    return redirectPreservingCookies(response, url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectPreservingCookies(response, url);
  }

  return response;
}

/**
 * Spotify OAuth コールバック処理。
 *
 * 1. state を cookie と照合 (CSRF 対策)
 * 2. code を access_token / refresh_token に交換
 * 3. Spotify ユーザー情報を取得
 * 4. トークンを暗号化して user_spotify_connections に upsert
 * 5. プロフィールページへリダイレクト
 */

import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";

import { encrypt } from "@/lib/crypto";
import { exchangeCodeForTokens, getSpotifyUser } from "@/lib/spotify/oauth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const STATE_COOKIE_NAME = "spotify_oauth_state";

// 旧 /profile に戻す代わりに /library のプロフィールセクションへリダイレクト
function redirectToProfile(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/library", req.url);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  // ユーザーがキャンセルした場合
  if (oauthError) {
    return redirectToProfile(req, { spotify_error: oauthError });
  }

  if (!code || !state) {
    return redirectToProfile(req, { spotify_error: "missing_params" });
  }

  // CSRF: cookie の state と照合
  const cookieStore = await cookies();
  const savedState = cookieStore.get(STATE_COOKIE_NAME)?.value;
  cookieStore.delete(STATE_COOKIE_NAME);
  if (!savedState || savedState !== state) {
    return redirectToProfile(req, { spotify_error: "invalid_state" });
  }

  // 認証チェック
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    // code → tokens
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // 通常含まれるはず。無い場合は再認可が必要。
      return redirectToProfile(req, { spotify_error: "no_refresh_token" });
    }

    // Spotify プロフィール取得
    const spotifyUser = await getSpotifyUser(tokens.access_token);

    const expiresAt = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // DB upsert (暗号化して保存)
    const { error: dbError } = await supabase
      .from("user_spotify_connections")
      .upsert(
        {
          user_id: user.id,
          spotify_user_id: spotifyUser.id,
          spotify_display_name: spotifyUser.display_name,
          access_token: encrypt(tokens.access_token),
          refresh_token: encrypt(tokens.refresh_token),
          scopes: tokens.scope.split(" "),
          expires_at: expiresAt,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );

    if (dbError) {
      console.error("Spotify connection save failed:", dbError);
      return redirectToProfile(req, { spotify_error: "db_error" });
    }

    return redirectToProfile(req, { spotify_connected: "true" });
  } catch (err) {
    console.error("Spotify callback error:", err);
    return redirectToProfile(req, { spotify_error: "oauth_failed" });
  }
}

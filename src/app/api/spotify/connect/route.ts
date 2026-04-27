/**
 * Spotify OAuth フローを開始するエンドポイント。
 *
 * 1. ユーザーが認証済みであることを確認
 * 2. CSRF 対策の state を生成、httpOnly cookie に保存
 * 3. Spotify の Authorization URL にリダイレクト
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { generateState, getAuthorizeUrl } from "@/lib/spotify/oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE_NAME = "spotify_oauth_state";

export async function GET(request: Request) {
  // 認証チェック (RLS のため cookie ベースのセッションが必要)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", "/profile");
    return NextResponse.redirect(loginUrl);
  }

  const state = generateState();

  // CSRF 防止: state を httpOnly cookie に保存して callback で照合
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10, // 10 分
    path: "/",
  });

  return NextResponse.redirect(getAuthorizeUrl(state));
}

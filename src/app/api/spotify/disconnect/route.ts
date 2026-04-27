/**
 * Spotify 連携を解除するエンドポイント。
 * トークンと同期した曲履歴を全削除する。
 */

import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // user_known_songs は user_spotify_connections の cascade ではないので個別に削除
  const { error: knownError } = await supabase
    .from("user_known_songs")
    .delete()
    .eq("user_id", user.id);
  if (knownError) {
    console.error("Failed to delete user_known_songs:", knownError);
  }

  const { error } = await supabase
    .from("user_spotify_connections")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // フォーム送信からの POST なら redirect、そうでなければ JSON
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return NextResponse.redirect(new URL("/profile", req.url), { status: 303 });
  }
  return NextResponse.json({ ok: true });
}

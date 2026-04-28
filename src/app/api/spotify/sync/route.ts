/**
 * Spotify からユーザーの聴取履歴を取得し、DB と照合して保存。
 *
 * フォーム送信からの POST はプロフィールへ redirect、
 * JSON リクエストの場合は同期結果を JSON で返す。
 */

import { type NextRequest, NextResponse } from "next/server";

import { syncUserSpotify } from "@/lib/spotify/sync";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function isFormSubmission(req: NextRequest): boolean {
  return (
    req.headers.get("content-type")?.includes("application/x-www-form-urlencoded") ?? false
  );
}

// 旧 /profile に戻す代わりに /library のプロフィールセクションへリダイレクト
function redirectToProfile(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/library", req.url);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncUserSpotify(user.id);

    if (isFormSubmission(req)) {
      return redirectToProfile(req, {
        spotify_synced: "true",
        matched: String(result.matchedSongs),
        found: String(result.totalFromSpotify),
      });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("Spotify sync error:", err);
    const message = err instanceof Error ? err.message : "unknown";
    if (isFormSubmission(req)) {
      return redirectToProfile(req, {
        spotify_error: "sync_failed",
        // URL 長制限のため 200 文字に切る
        sync_detail: message.slice(0, 200),
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * 表示中のデッキのシードを cookie に保存するエンドポイント。
 *
 * Server Component のレンダー中は cookie を書けないため、ホームが新しく
 * 組んだデッキ (初回・TTL 切れ・評価済みの補充後) はクライアントから
 * ここへ POST して保存する。次にホームを開いた時はこの cookie から
 * 同じデッキが復元され、タブ切替やアーティストページ往復で推薦が
 * 入れ替わらなくなる。
 *
 * Server Action ではなく Route Handler なのは、Server Action だと呼び出しの
 * たびに現在のルートが再レンダーされ、その再レンダーがまた保存を促す —
 * という往復を招きかねないため (cookie が保存できない環境で無限ループ)。
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DECK_COOKIE, DECK_COOKIE_OPTIONS, isDeckToken } from "@/lib/deck";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  let token: unknown;
  try {
    token = (await request.json())?.token;
  } catch {
    return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 });
  }

  // 中身は自分の推薦シードなので改竄されても他人には影響しないが、
  // 壊れた値で cookie を膨らませないよう形式を検証する。
  if (typeof token !== "string" || !isDeckToken(token)) {
    return NextResponse.json({ error: "不正なデッキ" }, { status: 400 });
  }

  (await cookies()).set(DECK_COOKIE, token, DECK_COOKIE_OPTIONS);
  return NextResponse.json({ ok: true });
}

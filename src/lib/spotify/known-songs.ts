/**
 * 現在のユーザーが Spotify で「聴いたことがある」と判定された song_id 集合を取得。
 *
 * user_known_songs テーブルから自分のレコードを引き、Set として返す。
 * UI 側はこの Set を持ち回って各楽曲が含まれるか確認する。
 *
 * 未連携 / 0 件 / セッション無効 の場合は空 Set を返す。
 */

import { createClient } from "@/lib/supabase/server";

export async function getUserKnownSongIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data } = await supabase
    .from("user_known_songs")
    .select("song_id")
    .eq("user_id", user.id);

  return new Set((data ?? []).map((r) => r.song_id));
}

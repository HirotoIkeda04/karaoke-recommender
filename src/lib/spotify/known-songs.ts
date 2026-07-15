/**
 * 現在のユーザーが Spotify で「聴いたことがある」と判定された song_id 集合を取得。
 *
 * user_known_songs テーブルから自分のレコードを引き、Set として返す。
 * UI 側はこの Set を持ち回って各楽曲が含まれるか確認する。
 *
 * 未連携 / 0 件 / セッション無効 の場合は空 Set を返す。
 */

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getUserKnownSongIds(
  existingClient?: SupabaseServerClient,
  existingUserId?: string | null,
): Promise<Set<string>> {
  const supabase = existingClient ?? (await createClient());
  let userId = existingUserId;

  // 呼び出し元がすでにセッションを読んでいる場合は、そのIDを再利用する。
  // RLSが auth.uid() と照合するため、Cookie由来のIDだけで他人の行は読めない。
  if (userId === undefined) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }
  if (!userId) return new Set();

  const { data } = await supabase
    .from("user_known_songs")
    .select("song_id")
    .eq("user_id", userId);

  return new Set((data ?? []).map((r) => r.song_id));
}

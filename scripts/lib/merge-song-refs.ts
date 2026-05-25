/**
 * 曲行を削除する前に、その曲を参照しているユーザーデータを別の曲へ「付け替える」
 * ための共通ヘルパー。
 *
 * 背景:
 *   evaluations / user_known_songs / song_logs は song_id を
 *   `references public.songs(id) on delete cascade` で参照している。
 *   そのため songs 行を DELETE すると、紐づくユーザー評価などが**黙って連鎖削除**される。
 *   重複統合 (dedup) や正規化 cleanup で「負け」側の曲を消すと、ユーザーが付けた評価が
 *   消失する事故が起きていた。
 *
 *   削除前に loser → winner へ参照を付け替えれば、ユーザーの評価は survivor 側に残る。
 *
 * 使い方:
 *   const moved = await mergeSongReferences(sb, loserId, winnerId);
 *   await sb.from("songs").delete().eq("id", loserId);
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";

type Sb = SupabaseClient<Database>;

export interface MergeRefsResult {
  /** winner へ song_id を付け替えた行数 (テーブル別) */
  moved: { evaluations: number; userKnownSongs: number; songLogs: number };
  /** winner に同一ユーザー行が既存で衝突したため loser 側を削除した行数 */
  deleted: { evaluations: number; userKnownSongs: number };
}

/**
 * loserSongId を参照する evaluations / user_known_songs / song_logs を
 * winnerSongId へ付け替える。winner 側に同じユーザーの行が既にある場合
 * (PK 衝突) は loser 側を削除して winner の評価を優先する。
 *
 * 呼び出し後に `songs` から loserSongId を DELETE すること。
 * 付け替え済みなので cascade で消える行は無くなる。
 */
export async function mergeSongReferences(
  sb: Sb,
  loserSongId: string,
  winnerSongId: string,
): Promise<MergeRefsResult> {
  if (loserSongId === winnerSongId) {
    throw new Error("mergeSongReferences: loser と winner が同一です");
  }

  const result: MergeRefsResult = {
    moved: { evaluations: 0, userKnownSongs: 0, songLogs: 0 },
    deleted: { evaluations: 0, userKnownSongs: 0 },
  };

  // --- evaluations (PK: user_id, song_id) ---
  {
    const { data: losers, error } = await sb
      .from("evaluations")
      .select("user_id")
      .eq("song_id", loserSongId);
    if (error) throw error;
    if (losers && losers.length > 0) {
      const { data: winners, error: wErr } = await sb
        .from("evaluations")
        .select("user_id")
        .eq("song_id", winnerSongId);
      if (wErr) throw wErr;
      const winnerUsers = new Set((winners ?? []).map((e) => e.user_id));
      for (const row of losers) {
        if (winnerUsers.has(row.user_id)) {
          // 衝突: winner 側の評価を残し loser 側を破棄
          const { error: dErr } = await sb
            .from("evaluations")
            .delete()
            .eq("user_id", row.user_id)
            .eq("song_id", loserSongId);
          if (dErr) throw dErr;
          result.deleted.evaluations++;
        } else {
          const { error: uErr } = await sb
            .from("evaluations")
            .update({ song_id: winnerSongId })
            .eq("user_id", row.user_id)
            .eq("song_id", loserSongId);
          if (uErr) throw uErr;
          result.moved.evaluations++;
        }
      }
    }
  }

  // --- user_known_songs (PK: user_id, song_id, source) ---
  {
    const { data: losers, error } = await sb
      .from("user_known_songs")
      .select("user_id, source")
      .eq("song_id", loserSongId);
    if (error) throw error;
    if (losers && losers.length > 0) {
      const { data: winners, error: wErr } = await sb
        .from("user_known_songs")
        .select("user_id, source")
        .eq("song_id", winnerSongId);
      if (wErr) throw wErr;
      const winnerKeys = new Set(
        (winners ?? []).map((k) => `${k.user_id}\t${k.source}`),
      );
      for (const row of losers) {
        const key = `${row.user_id}\t${row.source}`;
        if (winnerKeys.has(key)) {
          const { error: dErr } = await sb
            .from("user_known_songs")
            .delete()
            .eq("user_id", row.user_id)
            .eq("song_id", loserSongId)
            .eq("source", row.source);
          if (dErr) throw dErr;
          result.deleted.userKnownSongs++;
        } else {
          const { error: uErr } = await sb
            .from("user_known_songs")
            .update({ song_id: winnerSongId })
            .eq("user_id", row.user_id)
            .eq("song_id", loserSongId)
            .eq("source", row.source);
          if (uErr) throw uErr;
          result.moved.userKnownSongs++;
        }
      }
    }
  }

  // --- song_logs (代理 PK id・song_id は非ユニーク → 衝突なし、一括 UPDATE) ---
  {
    const { data, error } = await sb
      .from("song_logs")
      .update({ song_id: winnerSongId })
      .eq("song_id", loserSongId)
      .select("id");
    if (error) throw error;
    result.moved.songLogs = data?.length ?? 0;
  }

  return result;
}

/**
 * 指定した曲 id 群を参照している evaluations の件数を返す。
 * survivor が存在しない「非楽曲削除」系スクリプトで、削除によって失われる
 * ユーザー評価がどれだけあるかを事前に把握するための集計ヘルパー。
 */
export async function countEvaluationsForSongs(
  sb: Sb,
  songIds: string[],
): Promise<number> {
  let total = 0;
  for (let i = 0; i < songIds.length; i += 200) {
    const ids = songIds.slice(i, i + 200);
    const { count, error } = await sb
      .from("evaluations")
      .select("song_id", { count: "exact", head: true })
      .in("song_id", ids);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

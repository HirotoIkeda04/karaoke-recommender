/**
 * 「似た音域の楽曲」の選び方。
 *
 * 楽曲ページ (ボトムシート) の一覧と、ホームのデッキ詳細のカルーセルが
 * 同じ並びを出すためにここへ寄せてある。片方だけ直して基準がずれると、
 * 同じ曲なのに画面ごとに違う推薦が出て混乱するため。
 */
import "server-only";

import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type SimilarSong = Pick<
  Database["public"]["Tables"]["songs"]["Row"],
  | "id"
  | "title"
  | "artist"
  | "release_year"
  | "range_low_midi"
  | "range_high_midi"
  | "falsetto_max_midi"
  | "image_url_small"
  | "image_url_medium"
  | "duration_ms"
>;

export const SIMILAR_RANGE_WINDOW = 12;
export const SIMILAR_RANGE_LIMIT = 10;
// fame_score は日本語 Wikipedia 累計 pageviews の log10。5.0 ≈ 10 万 view で
// 「かなりの有名曲」の目安。これ未満は同アーティスト曲のみ候補にする。
export const SIMILAR_FAME_MIN = 5.0;

const SELECT =
  "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, duration_ms, fame_score, genres";

/**
 * 音域ウィンドウ内に絞った上で「同じアーティスト」「かなりの有名曲」
 * 「同系統ジャンル」を別々に引いてマージする。どれにも当てはまらない
 * 無名の他人曲は出さない。
 */
export async function fetchSimilarSongs(
  supabase: SupabaseServerClient,
  songId: string,
  artistId: string | null,
  genres: string[] | null,
  lowMidi: number,
  highMidi: number,
  limit: number = SIMILAR_RANGE_LIMIT,
): Promise<SimilarSong[]> {
  const rangeFiltered = () =>
    supabase
      .from("songs")
      .select(SELECT)
      .neq("id", songId)
      .gte("range_low_midi", lowMidi - SIMILAR_RANGE_WINDOW)
      .lte("range_low_midi", lowMidi + SIMILAR_RANGE_WINDOW)
      .gte("range_high_midi", highMidi - SIMILAR_RANGE_WINDOW)
      .lte("range_high_midi", highMidi + SIMILAR_RANGE_WINDOW);

  const genreList = (genres ?? []).filter(Boolean);

  const [sameArtistRes, famousRes, sameGenreRes] = await Promise.all([
    artistId
      ? rangeFiltered().eq("artist_id", artistId).limit(100)
      : Promise.resolve({ data: [] }),
    rangeFiltered().gte("fame_score", SIMILAR_FAME_MIN).limit(100),
    genreList.length > 0
      ? rangeFiltered().overlaps("genres", genreList).limit(100)
      : Promise.resolve({ data: [] }),
  ]);

  type Row = NonNullable<typeof famousRes.data>[number];
  const withDistance = (song: Row) => ({
    song,
    distance:
      Math.abs((song.range_low_midi ?? lowMidi) - lowMidi) +
      Math.abs((song.range_high_midi ?? highMidi) - highMidi),
  });
  const byDistance = (
    a: { song: Row; distance: number },
    b: { song: Row; distance: number },
  ) =>
    a.distance !== b.distance
      ? a.distance - b.distance
      : (b.song.fame_score ?? -Infinity) - (a.song.fame_score ?? -Infinity);

  const merged = new Map<string, Row>();
  for (const r of sameArtistRes.data ?? []) merged.set(r.id, r);
  for (const r of famousRes.data ?? []) merged.set(r.id, r);

  const ranked = Array.from(merged.values())
    .map(withDistance)
    .sort(byDistance)
    .slice(0, limit);

  // 少なくとも 1 曲は同系統ジャンルから出す。上位リストに同ジャンル曲が
  // 無ければ、最も音域が近い同ジャンル曲で末尾を差し替える。
  const sharesGenre = (s: Row) =>
    (s.genres ?? []).some((g) => genreList.includes(g));

  if (
    genreList.length > 0 &&
    ranked.length > 0 &&
    !ranked.some(({ song }) => sharesGenre(song))
  ) {
    const best = (sameGenreRes.data ?? [])
      .filter((s) => !merged.has(s.id))
      .map(withDistance)
      .sort(byDistance)[0];
    if (best) {
      // 枠に空きがあれば末尾に追加、埋まっていれば最遠の曲と差し替え
      if (ranked.length < limit) ranked.push(best);
      else ranked.splice(ranked.length - 1, 1, best);
    }
  }

  return ranked.map(({ song }) => song);
}

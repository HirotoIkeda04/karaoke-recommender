import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { LiveSearch } from "./live-search";

export const dynamic = "force-dynamic";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

type RankingPreviewSong = Pick<
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

// 各ジャンルの fame_score 上位曲のジャケット画像 URL を 4 件まで取得。
// BrowseGrid のカード背景 (2x2 モザイク) に使う。
//
// 実装メモ: ジャンルは songs.genres ではなくほぼ全て artists.genres 側に
// 入っているため (migration 011 参照)、artists_with_song_count を経由して
// アーティスト ID を引いてから songs を絞る。songs_with_genres VIEW は
// anon/auth に SELECT 権限が無いため使えない。
async function getGenreCovers(
  supabase: SupabaseServer,
): Promise<Partial<Record<GenreCode, string[]>>> {
  const out: Partial<Record<GenreCode, string[]>> = {};
  await Promise.all(
    GENRE_CODES.map(async (code) => {
      const { data: artistRows } = await supabase
        .from("artists_with_song_count")
        .select("id")
        .contains("genres", [code]);
      const artistIds = (artistRows ?? [])
        .map((r) => r.id)
        .filter((id): id is string => !!id);
      if (artistIds.length === 0) {
        out[code] = [];
        return;
      }
      const { data } = await supabase
        .from("songs")
        .select("image_url_small, image_url_medium, artist_id")
        .in("artist_id", artistIds)
        .order("fame_score", { ascending: false, nullsFirst: false })
        .order("spotify_popularity", { ascending: false, nullsFirst: false })
        .limit(64);
      // モザイクの色味が偏らないよう、同じアーティスト/同じジャケ URL は
      // 1 度ずつだけ採用して先頭 4 件を集める。
      const collected: string[] = [];
      const seenArtists = new Set<string>();
      for (const r of data ?? []) {
        const url = r.image_url_small ?? r.image_url_medium;
        if (!url) continue;
        if (collected.includes(url)) continue;
        if (r.artist_id && seenArtists.has(r.artist_id)) continue;
        collected.push(url);
        if (r.artist_id) seenArtists.add(r.artist_id);
        if (collected.length >= 4) break;
      }
      out[code] = collected;
    }),
  );
  return out;
}

export default async function SongsPage() {
  const supabase = await createClient();

  // 検索バー初期表示には全曲データは不要。
  // 自分のレーティングと Spotify 既知曲のみを軽量に渡す
  // (バッジ表示はクライアント側で id ルックアップする)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  const [knownIds, evalsRes, genreCovers, rankingPreview] = await Promise.all([
    getUserKnownSongIds(),
    userId
      ? supabase
          .from("evaluations")
          .select("song_id,rating")
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as Array<{ song_id: string; rating: string }> }),
    getGenreCovers(supabase),
    getRankingPreview(supabase),
  ]);

  const ratings: Record<string, string> = {};
  for (const ev of evalsRes.data ?? []) {
    ratings[ev.song_id] = ev.rating;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <LiveSearch
        ratings={ratings}
        knownSongIds={Array.from(knownIds)}
        genreCovers={genreCovers}
        rankingCovers={rankingPreview.covers}
        rankingPreview={rankingPreview.items}
      />
    </div>
  );
}

// 今週ランキングの上位 5 曲とジャケットを取得し、Browse の
// プレビュー一覧と既存の「今週のランキング」カード背景に使う。
async function getRankingPreview(supabase: SupabaseServer): Promise<{
  covers: string[];
  items: Array<{ rank: number; song: RankingPreviewSong }>;
}> {
  const { data: latest } = await supabase
    .from("weekly_rankings")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest) return { covers: [], items: [] };
  const { data: rankRows } = await supabase
    .from("weekly_rankings")
    .select("song_id, final_rank")
    .eq("week_start", latest.week_start)
    .order("final_rank", { ascending: true })
    .limit(12);
  const ids = (rankRows ?? []).map((r) => r.song_id);
  if (ids.length === 0) return { covers: [], items: [] };
  const { data: songs } = await supabase
    .from("songs")
    .select(
      "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, duration_ms",
    )
    .in("id", ids);
  const byId = new Map(
    ((songs ?? []) as RankingPreviewSong[]).map((song) => [song.id, song]),
  );
  const covers: string[] = [];
  for (const r of rankRows ?? []) {
    const song = byId.get(r.song_id);
    const url = song?.image_url_medium ?? song?.image_url_small;
    if (url && !covers.includes(url)) covers.push(url);
    if (covers.length >= 4) break;
  }
  const items: Array<{ rank: number; song: RankingPreviewSong }> = [];
  for (const row of rankRows ?? []) {
    const song = byId.get(row.song_id);
    if (!song) continue;
    items.push({ rank: row.final_rank, song });
    if (items.length >= 5) break;
  }
  return { covers, items };
}

import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";

import { LiveSearch } from "./live-search";

export const dynamic = "force-dynamic";

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

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
        .select("image_url_small, image_url_medium")
        .in("artist_id", artistIds)
        .order("fame_score", { ascending: false, nullsFirst: false })
        .order("spotify_popularity", { ascending: false, nullsFirst: false })
        .limit(16);
      // 同じジャケが連続しないよう dedupe しつつ先頭 4 件を採る
      const collected: string[] = [];
      for (const r of data ?? []) {
        const url = r.image_url_small ?? r.image_url_medium;
        if (!url) continue;
        if (collected.includes(url)) continue;
        collected.push(url);
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

  const [knownIds, evalsRes, genreCovers] = await Promise.all([
    getUserKnownSongIds(),
    userId
      ? supabase
          .from("evaluations")
          .select("song_id,rating")
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as Array<{ song_id: string; rating: string }> }),
    getGenreCovers(supabase),
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
      />
    </div>
  );
}

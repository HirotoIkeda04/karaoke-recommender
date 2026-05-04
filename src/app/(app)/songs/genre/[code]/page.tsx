import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { SongCard } from "@/components/song-card";
import { GENRE_LABELS, isGenreCode } from "@/lib/genres";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface GenrePageProps {
  params: Promise<{ code: string }>;
}

// ジャンルあたりの楽曲件数上限。
// fame_score (Wikipedia pageviews 由来の人気度) を主キーに並べるため、
// まずは 500 件で頭打ち。仮想化を入れるなら緩められる。
const SONG_LIMIT = 500;

export default async function GenreSongsPage({ params }: GenrePageProps) {
  const { code } = await params;
  if (!isGenreCode(code)) notFound();

  const supabase = await createClient();

  // songs_with_genres ビューには SELECT 権限が無いので、
  // 旧アーティスト一覧と同じ artists_with_song_count を経由する。
  // 1) このジャンルに属するアーティスト ID を取得
  // 2) songs を artist_id IN (...) でフィルタ
  // 3) 楽曲側の genres にも直接タグが付いているケースを別クエリで救済
  const { data: artistRows } = await supabase
    .from("artists_with_song_count")
    .select("id")
    .contains("genres", [code]);
  const artistIds = (artistRows ?? [])
    .map((r) => r.id)
    .filter((id): id is string => !!id);

  const songSelect =
    "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, fame_score, spotify_popularity";

  const [byArtistRes, byTagRes] = await Promise.all([
    artistIds.length > 0
      ? supabase
          .from("songs")
          .select(songSelect)
          .in("artist_id", artistIds)
          .order("fame_score", { ascending: false, nullsFirst: false })
          .order("spotify_popularity", { ascending: false, nullsFirst: false })
          .order("release_year", { ascending: false, nullsFirst: false })
          .order("title", { ascending: true })
          .limit(SONG_LIMIT)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("songs")
      .select(songSelect)
      .contains("genres", [code])
      .order("fame_score", { ascending: false, nullsFirst: false })
      .order("spotify_popularity", { ascending: false, nullsFirst: false })
      .order("release_year", { ascending: false, nullsFirst: false })
      .order("title", { ascending: true })
      .limit(SONG_LIMIT),
  ]);

  const error = byArtistRes.error ?? byTagRes.error;
  // id で dedupe して、人気順 (fame_score → spotify_popularity → year → title)
  // で並べ直す。NULL は最後に押しやる。
  type Row = NonNullable<typeof byTagRes.data>[number];
  const merged = new Map<string, Row>();
  for (const r of byArtistRes.data ?? []) merged.set(r.id, r);
  for (const r of byTagRes.data ?? []) merged.set(r.id, r);
  const songs = Array.from(merged.values())
    .sort((a, b) => {
      const af = a.fame_score ?? -Infinity;
      const bf = b.fame_score ?? -Infinity;
      if (af !== bf) return bf - af;
      const ap = a.spotify_popularity ?? -Infinity;
      const bp = b.spotify_popularity ?? -Infinity;
      if (ap !== bp) return bp - ap;
      const ay = a.release_year ?? -Infinity;
      const by = b.release_year ?? -Infinity;
      if (ay !== by) return by - ay;
      return a.title.localeCompare(b.title);
    })
    .slice(0, SONG_LIMIT);

  // 自分のレーティングと Spotify 既知曲を ID 集合で取得して
  // SongCard のバッジ表示に使う
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  const songIds = songs.map((s) => s.id);
  const [knownIds, evalsRes] = await Promise.all([
    getUserKnownSongIds(),
    userId && songIds.length > 0
      ? supabase
          .from("evaluations")
          .select("song_id,rating")
          .eq("user_id", userId)
          .in("song_id", songIds)
      : Promise.resolve({
          data: [] as Array<{ song_id: string; rating: string }>,
        }),
  ]);

  const ratings: Record<string, string> = {};
  for (const ev of evalsRes.data ?? []) {
    ratings[ev.song_id] = ev.rating;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <BackButton href="/songs" label="検索に戻る" />
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
          {GENRE_LABELS[code]}
        </h1>
        <span className="ml-auto text-xs text-zinc-500 dark:text-zinc-400">
          {songs.length.toLocaleString()} 曲
          {songs.length === SONG_LIMIT ? "+" : ""}
        </span>
      </div>

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </div>
      ) : songs.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          このジャンルの楽曲はまだ登録されていません
        </p>
      ) : (
        <ul>
          {songs.map((s) => (
            <li key={s.id}>
              <SongCard
                song={s}
                rating={ratings[s.id] ?? null}
                isKnown={knownIds.has(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

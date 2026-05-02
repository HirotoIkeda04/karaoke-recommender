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
// is_popular な曲を優先し、その後リリース年の新しい順で並べるため、
// まずは 500 件で頭打ち。仮想化を入れるなら緩められる。
const SONG_LIMIT = 500;

export default async function GenreSongsPage({ params }: GenrePageProps) {
  const { code } = await params;
  if (!isGenreCode(code)) notFound();

  const supabase = await createClient();

  // songs_with_genres: artists 由来の genres とソング独自タグを合成した
  // effective_genres を持つビュー。is_popular = DAM 由来の有名曲フラグ。
  const { data: rows, error } = await supabase
    .from("songs_with_genres")
    .select(
      "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, is_popular",
    )
    .contains("effective_genres", [code])
    .order("is_popular", { ascending: false, nullsFirst: false })
    .order("release_year", { ascending: false, nullsFirst: false })
    .order("title", { ascending: true })
    .limit(SONG_LIMIT);

  // SongCard 用に型を満たす行だけ抽出
  const songs = (rows ?? []).flatMap((r) =>
    r.id && r.title && r.artist
      ? [
          {
            id: r.id,
            title: r.title,
            artist: r.artist,
            release_year: r.release_year,
            range_low_midi: r.range_low_midi,
            range_high_midi: r.range_high_midi,
            falsetto_max_midi: r.falsetto_max_midi,
            image_url_small: r.image_url_small,
            image_url_medium: r.image_url_medium,
          },
        ]
      : [],
  );

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

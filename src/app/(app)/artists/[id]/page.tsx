import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { SongCard } from "@/components/song-card";
import { GENRE_LABELS, type GenreCode } from "@/lib/genres";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type Song = Pick<
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
  | "image_url_large"
  | "fame_score"
>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ArtistPageProps {
  params: Promise<{ id: string }>;
}

export default async function ArtistDetailPage({ params }: ArtistPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [artistRes, songsRes, knownIds] = await Promise.all([
    supabase
      .from("artists_with_song_count")
      .select("id, name, genres, song_count")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("songs")
      .select(
        "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium, image_url_large, fame_score",
      )
      .eq("artist_id", id),
    getUserKnownSongIds(),
  ]);

  if (artistRes.error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-600">{artistRes.error.message}</p>
      </div>
    );
  }
  if (!artistRes.data || !artistRes.data.id) notFound();

  const artist = artistRes.data;
  const songs = (songsRes.data ?? []) as Song[];

  const songIds = songs.map((s) => s.id);
  const evalsRes =
    songIds.length > 0
      ? await supabase
          .from("evaluations")
          .select("song_id, rating")
          .eq("user_id", user.id)
          .in("song_id", songIds)
      : { data: [] as Array<{ song_id: string; rating: string }> };
  const ratings: Record<string, string> = {};
  for (const row of evalsRes.data ?? []) {
    ratings[row.song_id] = row.rating;
  }

  // ヒーロー画像: release_year が最新の曲のジャケ (画像が無い曲はスキップ)
  const heroSong = songs
    .filter((s) => s.image_url_large || s.image_url_medium)
    .sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))[0];
  const heroImage =
    heroSong?.image_url_large ?? heroSong?.image_url_medium ?? null;

  // 人気の楽曲: fame_score 降順 Top 5
  const popular = songs
    .filter((s) => s.fame_score !== null)
    .sort((a, b) => (b.fame_score ?? 0) - (a.fame_score ?? 0))
    .slice(0, 5);

  // 全楽曲: 発売年 desc → タイトル asc
  const all = [...songs].sort((a, b) => {
    const ya = a.release_year ?? -Infinity;
    const yb = b.release_year ?? -Infinity;
    if (yb !== ya) return yb - ya;
    return a.title.localeCompare(b.title, "ja");
  });

  const songCount = artist.song_count ?? songs.length;
  const genres = (artist.genres ?? []) as string[];

  // 関連アーティスト:
  //   1. related_artists テーブルに rank 付きエントリがあればそれを優先 (Top200 のみ手動キュレーション済み)
  //   2. 無ければジャンル overlap で簡易フォールバック
  //   どちらも各アーティストの代表ジャケ (fame_score 最上位の曲) を併せて引く。
  type RelatedArtist = {
    id: string;
    name: string;
    song_count: number | null;
    image_url: string | null;
  };
  let relatedArtists: RelatedArtist[] = [];

  // (1) キュレーション済み related_artists を rank 順で取得
  //     related_artist_id は artists / artists_with_song_count の双方に FK を持つので
  //     関係名を artists!related_artist_id_fkey で明示。
  const { data: curated } = await supabase
    .from("related_artists")
    .select(
      "rank, related:artists!related_artists_related_artist_id_fkey (id, name)",
    )
    .eq("artist_id", id)
    .order("rank", { ascending: true })
    .limit(15);

  let rankedIds: { id: string; name: string }[] = [];
  if (curated && curated.length > 0) {
    rankedIds = curated.flatMap((row) => {
      const rel = row.related as { id: string; name: string } | null;
      return rel ? [{ id: rel.id, name: rel.name }] : [];
    });
  } else if (genres.length > 0) {
    // (2) フォールバック: ジャンル overlap 多い順
    const { data: candidates } = await supabase
      .from("artists_with_song_count")
      .select("id, name, genres, song_count")
      .overlaps("genres", genres)
      .neq("id", id)
      .limit(60);

    rankedIds = (candidates ?? [])
      .filter(
        (c): c is { id: string; name: string; genres: string[]; song_count: number | null } =>
          c.id !== null && c.name !== null,
      )
      .map((c) => {
        const overlap = (c.genres ?? []).filter((g) => genres.includes(g)).length;
        return { ...c, overlap };
      })
      .sort((a, b) => {
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        return (b.song_count ?? 0) - (a.song_count ?? 0);
      })
      .slice(0, 15)
      .map((c) => ({ id: c.id, name: c.name }));
  }

  if (rankedIds.length > 0) {
    // 代表ジャケ (fame_score 最上位の曲) を 1 枚拾う
    const { data: imgRows } = await supabase
      .from("songs")
      .select("artist_id, image_url_small, image_url_medium")
      .in(
        "artist_id",
        rankedIds.map((r) => r.id),
      )
      .not("image_url_small", "is", null)
      .order("fame_score", { ascending: false, nullsFirst: false })
      .limit(1000);

    const imageByArtist = new Map<string, string>();
    for (const row of imgRows ?? []) {
      if (!row.artist_id) continue;
      if (imageByArtist.has(row.artist_id)) continue;
      const url = row.image_url_small ?? row.image_url_medium;
      if (url) imageByArtist.set(row.artist_id, url);
    }

    relatedArtists = rankedIds.map((r) => ({
      id: r.id,
      name: r.name,
      song_count: null,
      image_url: imageByArtist.get(r.id) ?? null,
    }));
  }

  return (
    <div className="pb-8">
      {/* Spotify 風ヒーロー: 画像フルブリード + 下端に名前オーバーレイ */}
      <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-pink-500/40 to-zinc-900">
        {heroImage ? (
          <Image
            src={heroImage}
            alt=""
            fill
            sizes="(max-width: 28rem) 100vw, 28rem"
            priority
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-7xl text-white/60">
            ♪
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-black/85" />
        <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
          <BackButton variant="overlay" fallbackHref="/songs" />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-4 pb-5 sm:px-6">
          <h1 className="text-3xl font-bold leading-tight text-white drop-shadow-md sm:text-4xl">
            {artist.name}
          </h1>
          <p className="mt-1 text-sm text-white/85 drop-shadow">
            {songCount.toLocaleString()} 曲
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-6 px-4 pt-5">
        {genres.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {genres.map((g) => (
              <span
                key={g}
                className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
              >
                {GENRE_LABELS[g as GenreCode] ?? g}
              </span>
            ))}
          </div>
        ) : null}

        {popular.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              人気の楽曲
            </h2>
            <ul>
              {popular.map((s) => (
                <li key={s.id}>
                  <SongCard
                    song={s}
                    rating={ratings[s.id] ?? null}
                    isKnown={knownIds.has(s.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            全楽曲{" "}
            <span className="text-xs font-normal text-zinc-500">
              ({all.length})
            </span>
          </h2>
          {all.length === 0 ? (
            <p className="text-sm text-zinc-500">楽曲がありません</p>
          ) : (
            <ul>
              {all.map((s) => (
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
        </section>

        {relatedArtists.length > 0 ? (
          <section>
            <h2 className="mb-3 text-base font-bold text-zinc-900 dark:text-zinc-50">
              関連するアーティスト
            </h2>
            <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {relatedArtists.map((a) => (
                <li key={a.id} className="w-28 shrink-0">
                  <Link
                    href={`/artists/${a.id}`}
                    className="block focus:outline-none"
                  >
                    <div className="relative size-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      {a.image_url ? (
                        <Image
                          src={a.image_url}
                          alt=""
                          fill
                          sizes="7rem"
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-3xl text-zinc-500">
                          {a.name.slice(0, 1)}
                        </div>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-center text-xs font-medium text-zinc-900 dark:text-zinc-50">
                      {a.name}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

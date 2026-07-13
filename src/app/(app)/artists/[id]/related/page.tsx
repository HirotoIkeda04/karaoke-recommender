import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { JacketImage } from "@/components/ui/jacket-image";
import { getRelatedArtistPreviews } from "@/lib/related-artists";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RepresentativeSong = Pick<
  Database["public"]["Tables"]["songs"]["Row"],
  | "id"
  | "artist_id"
  | "title"
  | "release_year"
  | "image_url_small"
  | "image_url_medium"
  | "fame_score"
  | "cert_score"
  | "spotify_popularity"
>;

interface RelatedArtistsPageProps {
  params: Promise<{ id: string }>;
}

function popularityScore(song: RepresentativeSong) {
  return Math.max(
    song.fame_score ?? 0,
    song.cert_score ?? 0,
    (song.spotify_popularity ?? 0) / 20,
  );
}

export default async function RelatedArtistsPage({
  params,
}: RelatedArtistsPageProps) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  const { data: sourceArtist, error: sourceError } = await supabase
    .from("artists")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (sourceError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-sm text-red-600">{sourceError.message}</p>
      </div>
    );
  }
  if (!sourceArtist) notFound();

  const relatedBySource = await getRelatedArtistPreviews(supabase, [id], 6);
  const relatedArtists = relatedBySource[id] ?? [];
  const relatedIds = relatedArtists.map((artist) => artist.id);

  const songsByArtist = new Map<string, RepresentativeSong[]>();
  if (relatedIds.length > 0) {
    const { data: songRows } = await supabase
      .from("songs")
      .select(
        "id, artist_id, title, release_year, image_url_small, image_url_medium, fame_score, cert_score, spotify_popularity",
      )
      .in("artist_id", relatedIds)
      .limit(1000);

    for (const song of (songRows ?? []) as RepresentativeSong[]) {
      if (!song.artist_id) continue;
      const group = songsByArtist.get(song.artist_id) ?? [];
      group.push(song);
      songsByArtist.set(song.artist_id, group);
    }
    for (const [artistId, songs] of songsByArtist) {
      songsByArtist.set(
        artistId,
        songs
          .sort((a, b) => {
            const scoreDiff = popularityScore(b) - popularityScore(a);
            if (scoreDiff !== 0) return scoreDiff;
            return (b.release_year ?? 0) - (a.release_year ?? 0);
          })
          .slice(0, 3),
      );
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-4 pb-10">
      <header className="mb-6 flex items-start gap-2">
        <BackButton fallbackHref={`/artists/${id}`} />
        <div className="min-w-0 pt-1">
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            関連アーティスト
          </h1>
          <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {sourceArtist.name}に似たアーティストと代表楽曲
          </p>
        </div>
      </header>

      {relatedArtists.length === 0 ? (
        <div className="rounded-2xl bg-zinc-100 px-5 py-10 text-center dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            関連アーティストはまだ登録されていません。
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {relatedArtists.map((artist) => {
            const songs = songsByArtist.get(artist.id) ?? [];
            return (
              <section key={artist.id} aria-labelledby={`artist-${artist.id}`}>
                <Link
                  href={`/artists/${artist.id}`}
                  className="mb-2 flex items-center gap-3 rounded-xl py-1 transition hover:opacity-80"
                >
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    {artist.imageUrl ? (
                      <JacketImage
                        src={artist.imageUrl}
                        alt=""
                        fill
                        sizes="2.75rem"
                        className="object-cover"
                      />
                    ) : (
                      <span className="grid h-full place-items-center text-sm font-semibold text-zinc-500">
                        {artist.name.slice(0, 1)}
                      </span>
                    )}
                  </span>
                  <h2
                    id={`artist-${artist.id}`}
                    className="min-w-0 flex-1 truncate text-base font-bold text-zinc-900 dark:text-zinc-50"
                  >
                    {artist.name}
                  </h2>
                  <ChevronRight
                    className="size-4 shrink-0 text-zinc-400"
                    aria-hidden
                  />
                </Link>

                {songs.length > 0 ? (
                  <ul>
                    {songs.map((song) => {
                      const imageUrl =
                        song.image_url_small ?? song.image_url_medium;
                      return (
                        <li key={song.id}>
                          <Link
                            href={`/songs/${song.id}`}
                            className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800/60"
                          >
                            <span className="relative size-11 shrink-0 overflow-hidden rounded-md bg-zinc-200 dark:bg-zinc-800">
                              {imageUrl ? (
                                <JacketImage
                                  src={imageUrl}
                                  alt=""
                                  fill
                                  sizes="2.75rem"
                                  className="object-cover"
                                />
                              ) : (
                                <span className="grid h-full place-items-center text-lg text-zinc-500">
                                  ♪
                                </span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                                {song.title}
                              </span>
                              {song.release_year ? (
                                <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                                  {song.release_year}
                                </span>
                              ) : null}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-2 py-3 text-sm text-zinc-500">
                    代表楽曲はまだ登録されていません
                  </p>
                )}

                <Link
                  href={`/artists/${artist.id}`}
                  className="mt-1 inline-flex items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  もっと見る
                  <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

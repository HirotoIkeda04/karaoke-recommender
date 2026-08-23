import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export interface RelatedArtistPreview {
  id: string;
  name: string;
  imageUrl: string | null;
}

type ArtistCandidate = {
  id: string;
  name: string;
  genres: string[] | null;
  song_count: number | null;
};

/**
 * 複数の基準アーティストについて、表示順付きの関連アーティストをまとめて取得する。
 * related_artists のキュレーション結果を優先し、未登録の場合だけジャンル類似で補う。
 */
export async function getRelatedArtistPreviews(
  supabase: SupabaseClient<Database>,
  sourceArtistIds: ReadonlyArray<string>,
  limit = 3,
): Promise<Record<string, RelatedArtistPreview[]>> {
  const sourceIds = [...new Set(sourceArtistIds)];
  const result: Record<string, RelatedArtistPreview[]> = Object.fromEntries(
    sourceIds.map((id) => [id, []]),
  );
  if (sourceIds.length === 0) return result;

  const { data: curatedRows } = await supabase
    .from("related_artists")
    .select(
      "artist_id, rank, related:artists!related_artists_related_artist_id_fkey (id, name)",
    )
    .in("artist_id", sourceIds)
    .order("rank", { ascending: true });

  for (const row of curatedRows ?? []) {
    const related = row.related as { id: string; name: string } | null;
    if (!related || result[row.artist_id].length >= limit) continue;
    result[row.artist_id].push({
      id: related.id,
      name: related.name,
      imageUrl: null,
    });
  }

  const missingIds = sourceIds.filter((id) => result[id].length === 0);
  if (missingIds.length > 0) {
    const { data: sourceRows } = await supabase
      .from("artists")
      .select("id, genres")
      .in("id", missingIds);
    const sourceGenres = new Map(
      (sourceRows ?? []).map((artist) => [artist.id, artist.genres ?? []]),
    );
    const allGenres = [...new Set([...sourceGenres.values()].flat())];

    if (allGenres.length > 0) {
      const { data: candidateRows } = await supabase
        .from("artists_with_song_count")
        .select("id, name, genres, song_count")
        .overlaps("genres", allGenres)
        .limit(500);

      const candidates = (candidateRows ?? []).filter(
        (artist): artist is ArtistCandidate =>
          artist.id !== null && artist.name !== null,
      );

      for (const sourceId of missingIds) {
        const genres = sourceGenres.get(sourceId) ?? [];
        const genreSet = new Set(genres);
        result[sourceId] = candidates
          .filter((artist) => artist.id !== sourceId)
          .map((artist) => ({
            ...artist,
            overlap: (artist.genres ?? []).filter((genre) =>
              genreSet.has(genre),
            ).length,
          }))
          .filter((artist) => artist.overlap > 0)
          .sort((a, b) => {
            if (b.overlap !== a.overlap) return b.overlap - a.overlap;
            return (b.song_count ?? 0) - (a.song_count ?? 0);
          })
          .slice(0, limit)
          .map((artist) => ({
            id: artist.id,
            name: artist.name,
            imageUrl: null,
          }));
      }
    }
  }

  const relatedIds = [
    ...new Set(Object.values(result).flatMap((artists) => artists.map((a) => a.id))),
  ];
  if (relatedIds.length === 0) return result;

  const { data: imageRows } = await supabase
    .from("songs")
    .select("artist_id, image_url_small, image_url_medium")
    .in("artist_id", relatedIds)
    .order("fame_score", { ascending: false, nullsFirst: false })
    .limit(Math.max(relatedIds.length * 20, 100));

  const imageByArtist = new Map<string, string>();
  for (const song of imageRows ?? []) {
    if (!song.artist_id || imageByArtist.has(song.artist_id)) continue;
    const imageUrl = song.image_url_small ?? song.image_url_medium;
    if (imageUrl) imageByArtist.set(song.artist_id, imageUrl);
  }

  for (const sourceId of sourceIds) {
    result[sourceId] = result[sourceId].map((artist) => ({
      ...artist,
      imageUrl: imageByArtist.get(artist.id) ?? null,
    }));
  }

  return result;
}

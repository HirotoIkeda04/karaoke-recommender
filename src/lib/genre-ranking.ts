export interface GenreRankingCandidate {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  karaoke_score: number | null;
  fame_score: number | null;
  cert_score: number | null;
  spotify_popularity: number | null;
  release_year: number | null;
  original_release_year: number | null;
  dam_request_no: string | null;
  spotify_track_id: string | null;
  range_low_midi: number | null;
  range_high_midi: number | null;
}

const FEATURED_TIER_SIZE = 20;
const FEATURED_ARTIST_CAP = 2;
const PREVIEW_TIER_SIZE = 50;
const PREVIEW_ARTIST_CAP = 4;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function evidenceCount(song: GenreRankingCandidate) {
  let count = 0;
  if (song.dam_request_no) count++;
  if (song.spotify_track_id) count++;
  if (song.range_low_midi != null && song.range_high_midi != null) count++;
  return count;
}

/**
 * karaoke_score だけでは新しいヒット曲や欠損の多い曲を正しく比較できないため、
 * 実データの裏付け・知名度・認定・新しさを加えたジャンル内の表示スコア。
 */
export function genreRankingScore(
  song: GenreRankingCandidate,
  currentYear: number,
) {
  const evidence = evidenceCount(song);
  const confidence = [0.7, 0.82, 0.92, 1][evidence];
  const karaoke = (song.karaoke_score ?? 0) * confidence;
  const damCatalog = song.dam_request_no ? 0.12 : 0;
  const fame = 0.08 * clamp01((song.fame_score ?? 0) / 6);
  const certification = 0.04 * clamp01((song.cert_score ?? 0) / 5);
  const spotify = 0.08 * clamp01((song.spotify_popularity ?? 0) / 100);
  // 再発・再配信年で過去曲を新曲扱いしない。未照合曲だけ従来値へ戻す。
  const releaseYear = song.original_release_year ?? song.release_year;
  const recency =
    0.18 *
    clamp01(((releaseYear ?? currentYear - 10) - (currentYear - 10)) / 10);
  const completeness = 0.03 * (evidence / 3);

  return (
    karaoke +
    damCatalog +
    fame +
    certification +
    spotify +
    recency +
    completeness
  );
}

function artistKey(song: GenreRankingCandidate) {
  return (
    song.artist_id ??
    `name:${song.artist.normalize("NFKC").trim().toLocaleLowerCase("ja")}`
  );
}

function compareSongs(
  a: GenreRankingCandidate,
  b: GenreRankingCandidate,
  currentYear: number,
) {
  const scoreDifference =
    genreRankingScore(b, currentYear) - genreRankingScore(a, currentYear);
  if (scoreDifference !== 0) return scoreDifference;

  const karaokeDifference =
    (b.karaoke_score ?? -Infinity) - (a.karaoke_score ?? -Infinity);
  if (karaokeDifference !== 0) return karaokeDifference;

  const fameDifference =
    (b.fame_score ?? -Infinity) - (a.fame_score ?? -Infinity);
  if (fameDifference !== 0) return fameDifference;

  const spotifyDifference =
    (b.spotify_popularity ?? -Infinity) -
    (a.spotify_popularity ?? -Infinity);
  if (spotifyDifference !== 0) return spotifyDifference;

  const yearDifference =
    (b.original_release_year ?? b.release_year ?? -Infinity) -
    (a.original_release_year ?? a.release_year ?? -Infinity);
  if (yearDifference !== 0) return yearDifference;

  const titleDifference = a.title.localeCompare(b.title, "ja");
  return titleDifference !== 0 ? titleDifference : a.id.localeCompare(b.id);
}

/**
 * 上位だけ同一アーティストに占有されないよう段階的に選び、
 * それ以降にはスコア順の全候補を続ける。
 */
export function rankGenreSongs<T extends GenreRankingCandidate>(
  candidates: T[],
  currentYear: number,
) {
  const remaining = [...candidates].sort((a, b) =>
    compareSongs(a, b, currentYear),
  );
  const ranked: T[] = [];
  const artistCounts = new Map<string, number>();

  const fillTier = (targetSize: number, initialArtistCap: number) => {
    const target = Math.min(targetSize, candidates.length);
    let artistCap = initialArtistCap;

    while (ranked.length < target && remaining.length > 0) {
      const index = remaining.findIndex(
        (song) => (artistCounts.get(artistKey(song)) ?? 0) < artistCap,
      );

      if (index === -1) {
        artistCap++;
        continue;
      }

      const [song] = remaining.splice(index, 1);
      const key = artistKey(song);
      ranked.push(song);
      artistCounts.set(key, (artistCounts.get(key) ?? 0) + 1);
    }
  };

  fillTier(FEATURED_TIER_SIZE, FEATURED_ARTIST_CAP);
  fillTier(PREVIEW_TIER_SIZE, PREVIEW_ARTIST_CAP);

  return [...ranked, ...remaining];
}

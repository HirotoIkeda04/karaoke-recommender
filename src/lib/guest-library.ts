/**
 * ゲスト (未ログイン) のライブラリ表示値を localStorage の評価から組み立てる。
 *
 * ログイン中は DB 側の view が同じ数字を出している:
 *   推定音域   … user_voice_estimate      (migrations/001)
 *   ジャンル分布 … user_genre_distribution (migrations/014)
 * ゲストは evaluations に行が無いのでその view が使えず、ここで同じ定義を
 * TypeScript に移してある。**片方だけ直すと数字が食い違う**ので、view を
 * 変更したらこのファイルとテストも必ず一緒に直すこと。
 */
import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import type { GuestRatingMap, Rating } from "@/lib/guest-ratings";
import type { GuestSongRecord } from "@/lib/guest-songs";

/** library に出すのは 4 段階のみ。skip は表示しない (DB 版と同じ) */
export type DisplayRating = Exclude<Rating, "skip">;

const DISPLAY_RATINGS: ReadonlySet<string> = new Set([
  "easy",
  "practicing",
  "medium",
  "hard",
]);

/** ProfileHeader が読む推定音域。user_voice_estimate の列名に合わせてある */
export interface GuestVoiceEstimate {
  comfortable_min_midi: number | null;
  comfortable_max_midi: number | null;
  falsetto_max_midi: number | null;
  easy_count: number;
}

export interface GuestLibrary {
  evaluationsByRating: Record<
    DisplayRating,
    Array<{ rating: Rating; updated_at: string; song: GuestSongRecord }>
  >;
  eraBuckets: Record<number, number>;
  genreBuckets: Partial<Record<GenreCode, number>>;
  voiceEstimate: GuestVoiceEstimate;
  ratedSongCount: number;
}

/**
 * PostgreSQL の percentile_cont (連続パーセンタイル) と同じ計算。
 * 昇順に並べた値の間を線形補間する。空配列は null。
 */
export function percentileCont(
  sortedValues: readonly number[],
  fraction: number,
): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const position = fraction * (sortedValues.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return (
    sortedValues[lower] +
    (sortedValues[upper] - sortedValues[lower]) * (position - lower)
  );
}

const ascending = (a: number, b: number) => a - b;

export function buildGuestLibrary(
  ratings: GuestRatingMap,
  songs: readonly GuestSongRecord[],
): GuestLibrary {
  const byId = new Map(songs.map((song) => [song.id, song]));

  const evaluationsByRating: GuestLibrary["evaluationsByRating"] = {
    easy: [],
    practicing: [],
    medium: [],
    hard: [],
  };
  const eraBuckets: Record<number, number> = {};
  const genreCounts = new Map<string, number>();

  // 推定音域は「得意」評価だけから算出する (user_voice_estimate と同じ)
  const easyHighNotes: number[] = [];
  const easyLowNotes: number[] = [];
  let easyFalsettoMax: number | null = null;
  let easyCount = 0;

  const genreCodeSet = new Set<string>(GENRE_CODES);

  for (const [songId, entry] of Object.entries(ratings)) {
    const song = byId.get(songId);
    // ゲスト公開曲を入れ替えた後に残った古い評価は無視する
    if (!song) continue;
    if (!DISPLAY_RATINGS.has(entry.rating)) continue;
    const rating = entry.rating as DisplayRating;

    evaluationsByRating[rating].push({
      rating: entry.rating,
      updated_at: entry.updatedAt,
      song,
    });

    // 年代分布: 評価 4 段階すべてを 10 年単位でバケット (library/page.tsx と同じ)
    if (typeof song.release_year === "number") {
      const decade = Math.floor(song.release_year / 10) * 10;
      eraBuckets[decade] = (eraBuckets[decade] ?? 0) + 1;
    }

    // ジャンル分布: 「歌える曲」だけを数える。苦手 (hard) は嗜好ではないので
    // 除外する (user_genre_distribution の where 句と同じ)。
    if (rating !== "hard") {
      for (const genre of song.effective_genres) {
        if (!genreCodeSet.has(genre)) continue;
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      }
    }

    if (rating === "easy") {
      easyCount += 1;
      if (song.range_high_midi != null) easyHighNotes.push(song.range_high_midi);
      if (song.range_low_midi != null) easyLowNotes.push(song.range_low_midi);
      if (song.falsetto_max_midi != null) {
        easyFalsettoMax =
          easyFalsettoMax == null
            ? song.falsetto_max_midi
            : Math.max(easyFalsettoMax, song.falsetto_max_midi);
      }
    }
  }

  // 評価日の新しい順。SortableList 側でも並べ替えるが、既定の並びを
  // DB 版 (order by updated_at desc) と揃えておく。
  for (const rows of Object.values(evaluationsByRating)) {
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  const genreBuckets: Partial<Record<GenreCode, number>> = {};
  for (const [genre, count] of genreCounts) {
    genreBuckets[genre as GenreCode] = count;
  }

  return {
    evaluationsByRating,
    eraBuckets,
    genreBuckets,
    voiceEstimate: {
      // 快適な上限 = 得意曲の最高音の 75 パーセンタイル
      comfortable_max_midi: percentileCont(
        [...easyHighNotes].sort(ascending),
        0.75,
      ),
      // 快適な下限 = 得意曲の最低音の 25 パーセンタイル
      comfortable_min_midi: percentileCont(
        [...easyLowNotes].sort(ascending),
        0.25,
      ),
      falsetto_max_midi: easyFalsettoMax,
      easy_count: easyCount,
    },
    ratedSongCount: Object.values(evaluationsByRating).reduce(
      (total, rows) => total + rows.length,
      0,
    ),
  };
}

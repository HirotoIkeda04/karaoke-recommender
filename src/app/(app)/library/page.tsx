import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import { getGuestSongs } from "@/lib/guest-songs.server";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { fetchAllPaginated } from "@/lib/supabase/paginate";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { GuestLibrary } from "./guest-library";
import { ProfileHeader } from "./profile-header";
import { RatingTabs } from "./rating-tabs";
import { type EvaluationRow } from "./sortable-list";
// Spotify セクションは UI から外したが、コードは spotify-section.tsx に保持。
// 復活時は import を戻して下の JSX に再配置する。

export const dynamic = "force-dynamic";

type Rating = Database["public"]["Enums"]["rating_type"];
// library に表示するのは positive/negative の 4 段階のみ。skip は除外。
type DisplayRating = Exclude<Rating, "skip">;

const VALID_RATINGS: ReadonlySet<DisplayRating> = new Set([
  "easy",
  "practicing",
  "medium",
  "hard",
]);

const MIN_FOR_ESTIMATE = 5; // 「得意」評価がこの件数以上で推定音域を表示

// Supabase の 1000 行上限を range() のページ送りで越えて全評価を取得する
// (1000 件超のユーザーで「練習中」などのリストから曲が欠落する不具合を防ぐ)。
const EVAL_SELECT = `
      rating,
      updated_at,
      song:songs (
        id, title, artist, release_year,
        range_low_midi, range_high_midi, falsetto_max_midi,
        image_url_small, image_url_medium, duration_ms
      )
    `;

function fetchAllEvaluations(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ data: EvaluationRow[]; error: { message: string } | null }> {
  return fetchAllPaginated<EvaluationRow>((from, to) =>
    supabase
      .from("evaluations")
      .select(EVAL_SELECT)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .range(from, to),
  );
}

interface LibraryPageProps {
  searchParams: Promise<{
    tab?: string;
  }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const params = await searchParams;
  const requestedTab = params.tab as DisplayRating | undefined;
  const initialTab: DisplayRating =
    requestedTab && VALID_RATINGS.has(requestedTab) ? requestedTab : "easy";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ゲスト (未ログイン) は evaluations に行が無い。localStorage の評価と
  // 公開 70 曲から同じ画面を組み立てる (計算は src/lib/guest-library.ts)。
  if (!user) {
    return (
      <GuestLibrary
        songs={getGuestSongs()}
        initialTab={initialTab}
        minEasyForEstimate={MIN_FOR_ESTIMATE}
      />
    );
  }
  const userId = user.id;

  // === 並列取得: 評価一覧 / プロフィール / 音域 / フレンド数 / 評価年代分布 / ジャンル分布 ===
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [
    evalQueryRes,
    knownIds,
    profileRes,
    voiceEstimateRes,
    friendshipsRes,
    genreDistRes,
  ] = await Promise.all([
    fetchAllEvaluations(supabase, userId),
    getUserKnownSongIds(),
    supabase
      .from("profiles")
      .select("display_name, icon_color")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("user_voice_estimate")
      .select("comfortable_min_midi, comfortable_max_midi, falsetto_max_midi, easy_count")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("friendships")
      .select("user_a_id", { count: "exact", head: true })
      .eq("status", "accepted")
      .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
    // ジャンル分布 (014 マイグレーションの view) — db:types 再生成までは型が乗らないので as キャスト
    sb
      .from("user_genre_distribution")
      .select("genre, song_count")
      .eq("user_id", userId),
  ]);
  const { data: rows, error } = evalQueryRes;

  // 全評価を rating ごとに振り分け (元の order を保持)
  const evaluationsByRating: Record<DisplayRating, EvaluationRow[]> = {
    easy: [],
    practicing: [],
    medium: [],
    hard: [],
  };
  // 年代分布: release_year を 10年単位でバケット (評価一覧と同じ全件から算出)
  const eraBuckets: Record<number, number> = {};
  for (const row of (rows ?? []) as unknown as EvaluationRow[]) {
    if (row.rating === "skip" || !VALID_RATINGS.has(row.rating)) continue;
    evaluationsByRating[row.rating].push(row);
    const year = row.song?.release_year;
    if (typeof year === "number") {
      const decade = Math.floor(year / 10) * 10;
      eraBuckets[decade] = (eraBuckets[decade] ?? 0) + 1;
    }
  }

  // ジャンル分布: 不正値はサイレントスキップ (タクソノミ更新時の互換性確保)
  const genreBuckets: Partial<Record<GenreCode, number>> = {};
  const genreCodeSet = new Set<string>(GENRE_CODES);
  for (const row of (genreDistRes.data ?? []) as Array<{
    genre: string;
    song_count: number;
  }>) {
    if (!genreCodeSet.has(row.genre)) continue;
    genreBuckets[row.genre as GenreCode] = row.song_count;
  }

  const displayName = profileRes.data?.display_name ?? "(未設定)";
  const iconColor = profileRes.data?.icon_color ?? null;
  const friendCount = friendshipsRes.count ?? 0;
  const voiceEstimate = voiceEstimateRes.data ?? null;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      {/* プロフィールヘッダー (Instagram 風) */}
      <ProfileHeader
        displayName={displayName}
        iconColor={iconColor}
        friendCount={friendCount}
        ratedSongCount={
          (rows ?? []).filter(
            (r) =>
              r.rating !== "skip" && VALID_RATINGS.has(r.rating),
          ).length
        }
        voiceEstimate={voiceEstimate}
        eraBuckets={eraBuckets}
        genreBuckets={genreBuckets}
        minEasyForEstimate={MIN_FOR_ESTIMATE}
        viewMode="self"
      />

      {/* Spotify 連携セクションは UI から削除済み (コードは spotify-section.tsx に保持) */}

      {error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </div>
      ) : null}

      <RatingTabs
        evaluationsByRating={evaluationsByRating}
        knownSongIds={Array.from(knownIds)}
        initialTab={initialTab}
      />
    </div>
  );
}

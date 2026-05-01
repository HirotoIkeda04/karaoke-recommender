import Link from "next/link";

import { Button } from "@/components/ui/button";
import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { ProfileHeader } from "../../library/profile-header";
import { RatingTabs } from "../../library/rating-tabs";
import { type EvaluationRow } from "../../library/sortable-list";

export const dynamic = "force-dynamic";

type Rating = Database["public"]["Enums"]["rating_type"];

const VALID_RATINGS: ReadonlySet<Rating> = new Set([
  "easy",
  "practicing",
  "medium",
  "hard",
]);

const MIN_FOR_ESTIMATE = 5;

interface PageProps {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

interface FriendProfileRow {
  display_name: string;
  friend_count: number;
  rated_song_count: number;
  voice_comfortable_min_midi: number | null;
  voice_comfortable_max_midi: number | null;
  voice_falsetto_max_midi: number | null;
  voice_easy_count: number | null;
  era_buckets: Record<string, number> | null;
  genre_buckets: Record<string, number> | null;
}

interface FriendEvaluationRow {
  rating: Rating;
  updated_at: string;
  song_id: string;
  song_title: string;
  song_artist: string;
  song_release_year: number | null;
  song_range_low_midi: number | null;
  song_range_high_midi: number | null;
  song_falsetto_max_midi: number | null;
  song_image_url_small: string | null;
  song_image_url_medium: string | null;
}

export default async function FriendLibraryPage({
  params,
  searchParams,
}: PageProps) {
  const { userId: friendId } = await params;
  const { tab } = await searchParams;
  const requestedTab = tab as Rating | undefined;
  const initialTab: Rating =
    requestedTab && VALID_RATINGS.has(requestedTab) ? requestedTab : "easy";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // 自分自身の id だった場合は /library にリダイレクト相当
  if (user.id === friendId) {
    return (
      <NotFriendScreen
        title="自分のライブラリです"
        message="自分のライブラリは /library から見られます"
        backHref="/library"
        backLabel="ライブラリへ"
      />
    );
  }

  // RPC は型生成されていないので as キャストで呼ぶ
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [profileRes, evaluationsRes] = await Promise.all([
    sb.rpc("get_friend_library_profile", { p_friend_id: friendId }),
    sb.rpc("get_friend_library_evaluations", { p_friend_id: friendId }),
  ]);

  const profile = (profileRes.data?.[0] ?? null) as FriendProfileRow | null;

  if (!profile) {
    // フレンドではない or RPC エラー
    return (
      <NotFriendScreen
        title="閲覧できません"
        message="このユーザーとフレンドになるとライブラリを見られます"
        backHref="/friends"
        backLabel="フレンド画面へ"
      />
    );
  }

  // era_buckets jsonb (key=string) → Record<number, number>
  const eraBuckets: Record<number, number> = {};
  for (const [k, v] of Object.entries(profile.era_buckets ?? {})) {
    const decade = Number(k);
    if (Number.isFinite(decade)) {
      eraBuckets[decade] = v;
    }
  }

  // genre_buckets jsonb → Partial<Record<GenreCode, number>>
  const genreBuckets: Partial<Record<GenreCode, number>> = {};
  const genreCodeSet = new Set<string>(GENRE_CODES);
  for (const [k, v] of Object.entries(profile.genre_buckets ?? {})) {
    if (genreCodeSet.has(k)) {
      genreBuckets[k as GenreCode] = v;
    }
  }

  // RPC 行 → EvaluationRow へ整形
  const evaluationsByRating: Record<Rating, EvaluationRow[]> = {
    easy: [],
    practicing: [],
    medium: [],
    hard: [],
  };
  for (const row of (evaluationsRes.data ?? []) as FriendEvaluationRow[]) {
    if (!VALID_RATINGS.has(row.rating)) continue;
    evaluationsByRating[row.rating].push({
      rating: row.rating,
      updated_at: row.updated_at,
      song: {
        id: row.song_id,
        title: row.song_title,
        artist: row.song_artist,
        release_year: row.song_release_year,
        range_low_midi: row.song_range_low_midi,
        range_high_midi: row.song_range_high_midi,
        falsetto_max_midi: row.song_falsetto_max_midi,
        image_url_small: row.song_image_url_small,
        image_url_medium: row.song_image_url_medium,
      },
    });
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <ProfileHeader
        displayName={profile.display_name}
        friendCount={profile.friend_count}
        ratedSongCount={profile.rated_song_count}
        voiceEstimate={{
          comfortable_min_midi: profile.voice_comfortable_min_midi,
          comfortable_max_midi: profile.voice_comfortable_max_midi,
          falsetto_max_midi: profile.voice_falsetto_max_midi,
          easy_count: profile.voice_easy_count,
        }}
        eraBuckets={eraBuckets}
        genreBuckets={genreBuckets}
        minEasyForEstimate={MIN_FOR_ESTIMATE}
        viewMode="friend"
        friendUserId={friendId}
      />

      <RatingTabs
        evaluationsByRating={evaluationsByRating}
        knownSongIds={[]}
        initialTab={initialTab}
        linkable={false}
      />
    </div>
  );
}

function NotFriendScreen({
  title,
  message,
  backHref,
  backLabel,
}: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {title}
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
      <Link href={backHref} className="block">
        <Button variant="outline" size="lg" className="w-full">
          {backLabel}
        </Button>
      </Link>
    </div>
  );
}

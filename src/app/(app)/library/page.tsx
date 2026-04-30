import { Check, Dumbbell, Minus, X } from "lucide-react";
import Link from "next/link";

import { GENRE_CODES, type GenreCode } from "@/lib/genres";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { ProfileHeader } from "./profile-header";
import { SortableList, type EvaluationRow } from "./sortable-list";
import { SpotifySection } from "./spotify-section";
import { SwipeTabs } from "./swipe-tabs";

export const dynamic = "force-dynamic";

type Rating = Database["public"]["Enums"]["rating_type"];

const TABS: ReadonlyArray<{ value: Rating; label: string; Icon: typeof X }> = [
  { value: "easy", label: "得意", Icon: Check },
  { value: "practicing", label: "練習中", Icon: Dumbbell },
  { value: "medium", label: "普通", Icon: Minus },
  { value: "hard", label: "苦手", Icon: X },
];

const MIN_FOR_ESTIMATE = 5; // 「得意」評価がこの件数以上で推定音域を表示

interface LibraryPageProps {
  searchParams: Promise<{
    tab?: string;
    spotify_connected?: string;
    spotify_synced?: string;
    spotify_error?: string;
    matched?: string;
    found?: string;
    sync_detail?: string;
  }>;
}

export default async function LibraryPage({ searchParams }: LibraryPageProps) {
  const params = await searchParams;
  const activeTab = (params.tab ?? "easy") as Rating;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null; // middleware で防がれる想定
  }
  const userId = user.id;

  // === 並列取得: 評価一覧 / プロフィール / 音域 / フレンド数 / 評価年代分布 / Spotify / ジャンル分布 ===
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [
    evalQueryRes,
    knownIds,
    profileRes,
    voiceEstimateRes,
    friendshipsRes,
    yearDistRes,
    spotifyRes,
    genreDistRes,
  ] = await Promise.all([
    supabase
      .from("evaluations")
      .select(
        `
      rating,
      updated_at,
      song:songs (
        id, title, artist, release_year,
        range_low_midi, range_high_midi, falsetto_max_midi,
        image_url_small, image_url_medium
      )
    `,
      )
      .eq("user_id", userId)
      .eq("rating", activeTab)
      .order("updated_at", { ascending: false }),
    getUserKnownSongIds(),
    supabase
      .from("profiles")
      .select("display_name")
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
    supabase
      .from("evaluations")
      .select("song:songs(release_year)")
      .eq("user_id", userId),
    supabase
      .from("user_spotify_connections")
      .select("spotify_user_id, spotify_display_name, connected_at, last_synced_at")
      .eq("user_id", userId)
      .maybeSingle(),
    // ジャンル分布 (014 マイグレーションの view) — db:types 再生成までは型が乗らないので as キャスト
    sb
      .from("user_genre_distribution")
      .select("genre, song_count")
      .eq("user_id", userId),
  ]);
  const { data: rows, error } = evalQueryRes;

  // タブ別件数を別クエリで集計 (上のクエリは active タブだけ取ってきている)
  const { data: counts } = await supabase
    .from("evaluations")
    .select("rating", { count: "exact" })
    .eq("user_id", userId);
  const tabCounts: Record<Rating, number> = {
    easy: 0, medium: 0, hard: 0, practicing: 0,
  };
  for (const row of counts ?? []) {
    tabCounts[row.rating as Rating] += 1;
  }

  // 年代分布: release_year を 10年単位でバケット
  const eraBuckets: Record<number, number> = {};
  for (const row of yearDistRes.data ?? []) {
    const year = row.song?.release_year;
    if (typeof year !== "number") continue;
    const decade = Math.floor(year / 10) * 10;
    eraBuckets[decade] = (eraBuckets[decade] ?? 0) + 1;
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
  const friendCount = friendshipsRes.count ?? 0;
  const voiceEstimate = voiceEstimateRes.data ?? null;
  const spotifyConnection = spotifyRes.data ?? null;

  // Spotify 接続済みなら known songs 件数を取得
  let knownSongsCount = 0;
  if (spotifyConnection) {
    const { data: distinctRows } = await supabase
      .from("user_known_songs")
      .select("song_id")
      .eq("user_id", userId);
    knownSongsCount = distinctRows
      ? new Set(distinctRows.map((r) => r.song_id)).size
      : 0;
  }

  // Spotify 通知系パラメータ
  const spotifyNotice = {
    connected: params.spotify_connected === "true",
    syncedSummary:
      params.spotify_synced === "true" && params.matched && params.found
        ? {
            matched: parseInt(params.matched, 10),
            found: parseInt(params.found, 10),
          }
        : null,
    error: params.spotify_error ?? null,
    errorDetail: params.sync_detail ?? null,
  };

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      {/* プロフィールヘッダー (Instagram 風) */}
      <ProfileHeader
        displayName={displayName}
        friendCount={friendCount}
        voiceEstimate={voiceEstimate}
        eraBuckets={eraBuckets}
        genreBuckets={genreBuckets}
        minEasyForEstimate={MIN_FOR_ESTIMATE}
      />

      {/* Spotify 連携 */}
      <SpotifySection
        connection={spotifyConnection}
        knownSongsCount={knownSongsCount}
        notice={spotifyNotice}
      />

      {/* 評価タブ + 一覧 (横スワイプで切り替え可能) */}
      {(() => {
        const idx = TABS.findIndex((t) => t.value === activeTab);
        const prevHref =
          idx > 0 ? `/library?tab=${TABS[idx - 1].value}` : null;
        const nextHref =
          idx >= 0 && idx < TABS.length - 1
            ? `/library?tab=${TABS[idx + 1].value}`
            : null;
        return (
          <SwipeTabs prevHref={prevHref} nextHref={nextHref}>
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
              {TABS.map((tab) => {
                const active = tab.value === activeTab;
                return (
                  <Link
                    key={tab.value}
                    href={`/library?tab=${tab.value}`}
                    className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-xs ${
                      active
                        ? "bg-white shadow-sm dark:bg-zinc-900"
                        : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1">
                      <tab.Icon className="size-3.5" aria-hidden />
                      {tab.label}
                    </span>
                    <span className="text-[10px] tabular-nums text-zinc-500">
                      {tabCounts[tab.value]}
                    </span>
                  </Link>
                );
              })}
            </div>

            {error ? (
              <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error.message}
              </div>
            ) : null}

            <div className="mt-4">
              {(rows ?? []).length === 0 ? (
                <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  このカテゴリの曲はまだありません
                </div>
              ) : (
                <SortableList
                  evaluations={(rows ?? []) as unknown as EvaluationRow[]}
                  knownSongIds={Array.from(knownIds)}
                />
              )}
            </div>
          </SwipeTabs>
        );
      })()}
    </div>
  );
}

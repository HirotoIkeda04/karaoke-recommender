/**
 * /rankings — 週次ランキング (Spotify Top 50 + Apple Music Top 100 の合算)
 *
 * データソース: weekly_rankings テーブル (migration 047)。
 * 最新 week_start を 1 つ選び、final_rank 昇順で songs を join して表示。
 *
 * 各曲には Spotify / Apple それぞれの順位バッジを並べる。
 */
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { SongCard } from "@/components/song-card";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type RankingRow = Pick<
  Database["public"]["Tables"]["weekly_rankings"]["Row"],
  "song_id" | "final_rank" | "score" | "sources" | "week_start"
>;

type SongRow = Pick<
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
>;

function formatWeekRange(weekStart: string): string {
  // weekStart は YYYY-MM-DD (月曜 UTC)。日本ユーザー向けに「M/D 週」と表記。
  const d = new Date(`${weekStart}T00:00:00Z`);
  const end = new Date(d);
  end.setUTCDate(end.getUTCDate() + 6);
  const fmt = (x: Date) =>
    `${x.getUTCMonth() + 1}/${x.getUTCDate()}`;
  return `${fmt(d)} – ${fmt(end)} の週`;
}

export default async function RankingsPage() {
  const supabase = await createClient();

  // 最新の week_start を 1 件取得
  const { data: latestRow } = await supabase
    .from("weekly_rankings")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestRow) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-4">
        <PageHeader />
        <p className="px-2 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          まだランキングデータがありません。
          <br />
          初回取得が完了するまでお待ちください。
        </p>
      </div>
    );
  }

  const weekStart = latestRow.week_start;

  // ランキング行 + 対応する songs を一括取得
  const { data: rankRows } = await supabase
    .from("weekly_rankings")
    .select("song_id, final_rank, score, sources, week_start")
    .eq("week_start", weekStart)
    .order("final_rank", { ascending: true })
    .limit(100);

  const rows = (rankRows ?? []) as RankingRow[];
  const songIds = rows.map((r) => r.song_id);

  const songsById = new Map<string, SongRow>();
  if (songIds.length > 0) {
    const { data: songs } = await supabase
      .from("songs")
      .select(
        "id, title, artist, release_year, range_low_midi, range_high_midi, falsetto_max_midi, image_url_small, image_url_medium",
      )
      .in("id", songIds);
    for (const s of (songs ?? []) as SongRow[]) songsById.set(s.id, s);
  }

  // 評価 / Spotify 既知曲を取得 (バッジ表示)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  const [knownIds, evalsRes] = await Promise.all([
    getUserKnownSongIds(),
    userId
      ? supabase
          .from("evaluations")
          .select("song_id, rating")
          .eq("user_id", userId)
          .in("song_id", songIds.length > 0 ? songIds : ["00000000-0000-0000-0000-000000000000"])
      : Promise.resolve({ data: [] as Array<{ song_id: string; rating: string }> }),
  ]);
  const ratings: Record<string, string> = {};
  for (const ev of evalsRes.data ?? []) ratings[ev.song_id] = ev.rating;
  const knownSet = new Set(knownIds);

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <PageHeader />
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {formatWeekRange(weekStart)} / Apple Music Top 100 と YouTube Top 50
        (Music) を合算
      </p>
      <ol className="space-y-1">
        {rows.map((r) => {
          const song = songsById.get(r.song_id);
          if (!song) return null;
          return (
            <li key={r.song_id} className="flex items-center gap-2">
              <div className="w-7 shrink-0 text-right text-base font-bold tabular-nums text-zinc-700 dark:text-zinc-200">
                {r.final_rank}
              </div>
              <div className="min-w-0 flex-1">
                <SongCard
                  song={song}
                  rating={ratings[song.id] ?? null}
                  isKnown={knownSet.has(song.id)}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function PageHeader() {
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/songs"
        className="grid size-8 place-items-center rounded-md text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        aria-label="戻る"
      >
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        今週のランキング
      </h1>
    </div>
  );
}


import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { LiveSearch } from "./live-search";

export const dynamic = "force-dynamic";

const SONG_COLS =
  "id,title,artist,release_year,range_low_midi,range_high_midi,falsetto_max_midi,image_url_small,image_url_medium";
// Supabase Cloud の PostgREST は db-max-rows=1000 で固定されており、
// クライアント側で .range(0, 49999) を指定してもサーバー側でクランプされる。
// そのため 1000 件ずつチャンクページネーションでループ取得する。
const PAGE_SIZE = 1000;

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
>;

export default async function SongsPage() {
  const supabase = await createClient();

  // 1. 総件数を取得してチャンク数を決定 (head: true で行データは返さないので軽量)
  const { count, error: countErr } = await supabase
    .from("songs")
    .select("id", { count: "exact", head: true });

  const totalCount = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  // 2. 全チャンク + Spotify known song を並列取得
  // 並び替えのキーは (artist, title, id) — id を最終タイブレーカーにすることで
  // 同一 (artist, title) の曲がチャンク跨ぎで重複/欠落しないようにする
  const [knownIds, ...chunkResults] = await Promise.all([
    getUserKnownSongIds(),
    ...Array.from({ length: pageCount }, (_, i) =>
      supabase
        .from("songs")
        .select(SONG_COLS)
        .order("artist", { ascending: true })
        .order("title", { ascending: true })
        .order("id", { ascending: true })
        .range(i * PAGE_SIZE, (i + 1) * PAGE_SIZE - 1),
    ),
  ]);

  const songsErr = countErr ?? chunkResults.find((r) => r.error)?.error ?? null;
  const songs = chunkResults.flatMap((r) => r.data ?? []) as Song[];

  // 自分の評価マップを構築 (rating badge 表示用)
  const ratings: Record<string, string> = {};
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (userId) {
    const { data: evals } = await supabase
      .from("evaluations")
      .select("song_id,rating")
      .eq("user_id", userId);
    for (const ev of evals ?? []) {
      ratings[ev.song_id] = ev.rating;
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      {songsErr ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {songsErr.message}
        </div>
      ) : (
        <LiveSearch
          songs={songs}
          ratings={ratings}
          knownSongIds={Array.from(knownIds)}
          totalCount={totalCount || songs.length}
        />
      )}
    </div>
  );
}

import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { SwipeDeck } from "./swipe-deck";

export const dynamic = "force-dynamic";

type Song = Database["public"]["Tables"]["songs"]["Row"];

export default async function HomePage() {
  const supabase = await createClient();

  // 未評価の代表曲を 20 件ずつデッキに積む。
  // 並行して、Spotify で聴いたことのある song_id 集合も取得 (バッジ表示用)。
  const [unratedRes, knownIds] = await Promise.all([
    // 020 までの get_unrated_songs では PostgREST 接続プールが旧プランを
    // キャッシュし続け、推薦ロジック更新が反映されない問題があった。
    // _v2 として別関数名で作り直し、強制的に新エンドポイントを叩かせる。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)("get_unrated_songs_v2", {
      p_limit: 20,
      p_popular_only: true,
      p_require_image: true,
    }),
    getUserKnownSongIds(),
  ]);
  const { data, error } = unratedRes;

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-600">読み込みエラー</h1>
        <pre className="mt-4 rounded bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </pre>
      </div>
    );
  }

  const songs = (data ?? []) as Song[];

  if (songs.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">代表曲をすべて評価しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          検索ページから他の曲も評価できます。
        </p>
        <Link href="/songs" className={buttonVariants({ size: "lg" })}>
          楽曲を検索する
        </Link>
      </div>
    );
  }

  return (
    <SwipeDeck initialSongs={songs} knownSongIds={Array.from(knownIds)} />
  );
}

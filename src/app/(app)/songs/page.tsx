import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { LiveSearch } from "./live-search";

export const dynamic = "force-dynamic";

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

  // 全曲を一括取得 (artist 順 → title 順)
  // ローカルでフィルタするので server-side LIMIT は無し
  const songsRes = await supabase
    .from("songs")
    .select(
      "id,title,artist,release_year,range_low_midi,range_high_midi,falsetto_max_midi,image_url_small,image_url_medium",
    )
    .order("artist", { ascending: true })
    .order("title", { ascending: true });

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

  const songs = (songsRes.data ?? []) as Song[];

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      {songsRes.error ? (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {songsRes.error.message}
        </div>
      ) : (
        <LiveSearch songs={songs} ratings={ratings} />
      )}
    </div>
  );
}

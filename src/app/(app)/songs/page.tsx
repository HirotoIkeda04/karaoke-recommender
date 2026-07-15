import { getBrowseSnapshot } from "@/lib/browse-snapshot";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";

import { LiveSearch } from "./live-search";

export const dynamic = "force-dynamic";

export default async function SongsPage() {
  const supabase = await createClient();

  // 検索バー初期表示には全曲データは不要。
  // 自分のレーティングと Spotify 既知曲のみを軽量に渡す
  // (バッジ表示はクライアント側で id ルックアップする)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  const [knownIds, evalsRes, browseSnapshot] = await Promise.all([
    getUserKnownSongIds(supabase, userId),
    userId
      ? supabase
          .from("evaluations")
          .select("song_id,rating")
          .eq("user_id", userId)
      : Promise.resolve({ data: [] as Array<{ song_id: string; rating: string }> }),
    getBrowseSnapshot(),
  ]);

  const ratings: Record<string, string> = {};
  for (const ev of evalsRes.data ?? []) {
    ratings[ev.song_id] = ev.rating;
  }

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      <LiveSearch
        ratings={ratings}
        knownSongIds={Array.from(knownIds)}
        genreCovers={browseSnapshot.genreCovers}
        rankingCovers={browseSnapshot.rankingCovers}
        rankingPreview={browseSnapshot.rankingPreview}
      />
    </div>
  );
}

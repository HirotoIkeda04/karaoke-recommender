import { getBrowseSnapshot } from "@/lib/browse-snapshot";
import { getGuestSongs } from "@/lib/guest-songs.server";
import { getUserKnownSongIds } from "@/lib/spotify/known-songs";
import { createClient } from "@/lib/supabase/server";

import { GuestLiveSearch } from "./guest-live-search";
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

  // ゲスト (未ログイン) は検索 RPC を実行できないので、公開 70 曲を渡して
  // 手元で絞り込ませる。評価バッジも localStorage 由来になる。
  if (!userId) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-4">
        <GuestLiveSearch songs={getGuestSongs()} />
      </div>
    );
  }

  const [knownIds, evalsRes, browseSnapshot] = await Promise.all([
    getUserKnownSongIds(supabase, userId),
    supabase
      .from("evaluations")
      .select("song_id,rating")
      .eq("user_id", userId),
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

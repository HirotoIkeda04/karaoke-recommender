/**
 * Spotify からユーザーの「聴いた曲」を取得し、songs テーブルと
 * 照合して user_known_songs に保存する。
 *
 * 取得対象 (5 sources):
 *   1. /me/top/tracks?time_range=short_term  (過去 4 週間)
 *   2. /me/top/tracks?time_range=medium_term (過去 6 ヶ月)
 *   3. /me/top/tracks?time_range=long_term   (全期間)
 *   4. /me/player/recently-played            (直近の再生履歴 50 曲)
 *   5. /me/tracks                            (Liked Songs)
 *
 * 各 source ごとに最大 50 曲。重複可。
 * songs.spotify_track_id と一致するものだけを user_known_songs に保存。
 */

import { getValidAccessToken, spotifyGet } from "@/lib/spotify/client";
import { createClient } from "@/lib/supabase/server";

type Source =
  | "top_short_term"
  | "top_medium_term"
  | "top_long_term"
  | "recently_played"
  | "saved";

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
}

interface TopTracksResponse {
  items: SpotifyTrack[];
}

interface RecentlyPlayedResponse {
  items: Array<{ track: SpotifyTrack; played_at: string }>;
}

interface SavedTracksResponse {
  items: Array<{ track: SpotifyTrack; added_at: string }>;
}

interface SyncResult {
  /** Spotify から取得した unique なトラック数 */
  totalFromSpotify: number;
  /** DB の songs と一致した unique 曲数 */
  matchedSongs: number;
  /** source 別のマッチ数 */
  bySource: Record<Source, number>;
}

export async function syncUserSpotify(userId: string): Promise<SyncResult> {
  const accessToken = await getValidAccessToken(userId);

  // 5 source を並列取得
  const [topShort, topMedium, topLong, recent, saved] = await Promise.all([
    spotifyGet<TopTracksResponse>(accessToken, "/me/top/tracks", {
      time_range: "short_term",
      limit: "50",
    }),
    spotifyGet<TopTracksResponse>(accessToken, "/me/top/tracks", {
      time_range: "medium_term",
      limit: "50",
    }),
    spotifyGet<TopTracksResponse>(accessToken, "/me/top/tracks", {
      time_range: "long_term",
      limit: "50",
    }),
    spotifyGet<RecentlyPlayedResponse>(
      accessToken,
      "/me/player/recently-played",
      { limit: "50" },
    ),
    spotifyGet<SavedTracksResponse>(accessToken, "/me/tracks", {
      limit: "50",
    }),
  ]);

  // source 別にトラック ID を整理
  const tracksBySource: Record<Source, Array<{ id: string; rank: number | null }>> = {
    top_short_term: topShort.items.map((t, i) => ({ id: t.id, rank: i + 1 })),
    top_medium_term: topMedium.items.map((t, i) => ({ id: t.id, rank: i + 1 })),
    top_long_term: topLong.items.map((t, i) => ({ id: t.id, rank: i + 1 })),
    recently_played: recent.items.map(({ track }) => ({
      id: track.id,
      rank: null,
    })),
    saved: saved.items.map(({ track }) => ({ id: track.id, rank: null })),
  };

  // ユニーク Spotify track IDs を集める
  const allSpotifyIds = new Set<string>();
  for (const arr of Object.values(tracksBySource)) {
    for (const t of arr) allSpotifyIds.add(t.id);
  }

  if (allSpotifyIds.size === 0) {
    return {
      totalFromSpotify: 0,
      matchedSongs: 0,
      bySource: {
        top_short_term: 0,
        top_medium_term: 0,
        top_long_term: 0,
        recently_played: 0,
        saved: 0,
      },
    };
  }

  const supabase = await createClient();

  // songs テーブルと照合 (spotify_track_id で IN 検索)
  const { data: matchedSongs, error: matchErr } = await supabase
    .from("songs")
    .select("id, spotify_track_id")
    .in("spotify_track_id", Array.from(allSpotifyIds));
  if (matchErr) {
    throw new Error(`Songs match failed: ${matchErr.message}`);
  }

  // spotify_track_id → song_id のマップ
  const trackToSong = new Map<string, string>();
  for (const s of matchedSongs ?? []) {
    if (s.spotify_track_id) trackToSong.set(s.spotify_track_id, s.id);
  }

  // 既存の user_known_songs を全削除して入れ替え (簡素化のため)
  const { error: delErr } = await supabase
    .from("user_known_songs")
    .delete()
    .eq("user_id", userId);
  if (delErr) {
    throw new Error(`Delete known songs failed: ${delErr.message}`);
  }

  // user_known_songs に insert する行を作成 (source 単位、複数 source に重複可)
  const now = new Date().toISOString();
  const rows: Array<{
    user_id: string;
    song_id: string;
    source: Source;
    rank: number | null;
    last_seen: string;
  }> = [];
  const bySource: Record<Source, number> = {
    top_short_term: 0,
    top_medium_term: 0,
    top_long_term: 0,
    recently_played: 0,
    saved: 0,
  };

  for (const [src, tracks] of Object.entries(tracksBySource) as Array<
    [Source, Array<{ id: string; rank: number | null }>]
  >) {
    // recently_played 等は同曲が複数回登場し得る (連続再生)。
    // primary key = (user_id, song_id, source) に重複は禁物なので源泉単位で dedupe。
    const seenSongs = new Set<string>();
    for (const t of tracks) {
      const songId = trackToSong.get(t.id);
      if (!songId) continue;
      if (seenSongs.has(songId)) continue;
      seenSongs.add(songId);
      rows.push({
        user_id: userId,
        song_id: songId,
        source: src,
        rank: t.rank,
        last_seen: now,
      });
      bySource[src] += 1;
    }
  }

  if (rows.length > 0) {
    const { error: insErr } = await supabase
      .from("user_known_songs")
      .insert(rows);
    if (insErr) {
      throw new Error(`Insert known songs failed: ${insErr.message}`);
    }
  }

  // last_synced_at 更新
  await supabase
    .from("user_spotify_connections")
    .update({ last_synced_at: now })
    .eq("user_id", userId);

  // ユニークなマッチ曲数
  const matchedSongIds = new Set(rows.map((r) => r.song_id));

  return {
    totalFromSpotify: allSpotifyIds.size,
    matchedSongs: matchedSongIds.size,
    bySource,
  };
}

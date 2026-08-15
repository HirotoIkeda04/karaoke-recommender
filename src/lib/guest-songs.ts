/**
 * 未ログイン (ゲスト) 体験で使う固定曲リストの型とヘルパー。
 *
 * ゲストは Supabase を一切叩かない。曲データは scripts/build-guest-songs.ts が
 * 生成した src/data/guest-songs.json をサーバー側で読み、props でクライアントに
 * 渡す (guest-songs.server.ts を参照)。このおかげでゲスト用に RLS / GRANT を
 * 開ける必要が無い。
 *
 * このファイルはクライアントからも import されるので JSON は読まないこと。
 * JSON を読むのは guest-songs.server.ts だけ。
 */
import type { Database } from "@/types/database";

type Song = Database["public"]["Tables"]["songs"]["Row"];

/**
 * JSON に載せる songs の列。UI が実際に読む列だけに絞ってある
 * (全列だと source_urls などスクレイパの内部管理列で 3 倍近く膨らむ)。
 * ここに列を足したら scripts/build-guest-songs.ts を再実行すること。
 */
export const GUEST_SONG_COLUMNS = [
  "id",
  "title",
  "artist",
  "artist_id",
  "release_year",
  "original_release_year",
  "genres",
  "range_low_midi",
  "range_high_midi",
  "falsetto_max_midi",
  "image_url_small",
  "image_url_medium",
  "image_url_large",
  "itunes_preview_url",
  "spotify_track_id",
  "spotify_popularity",
  "duration_ms",
  "fame_score",
  "cert_score",
  "karaoke_score",
  "is_popular",
] as const satisfies readonly (keyof Song)[];

type GuestSongColumn = (typeof GUEST_SONG_COLUMNS)[number];

/** JSON の 1 レコード */
export type GuestSongRecord = Pick<Song, GuestSongColumn> & {
  /**
   * artists.genres からの継承を解決済みのジャンル。ゲストは artists を
   * 読めないので、ジャンル分布の集計はこの列を使う
   * (user_genre_distribution の coalesce(songs.genres, artists.genres) 相当)。
   */
  effective_genres: string[];
};

export interface GuestSongsFile {
  generatedAt: string;
  songs: GuestSongRecord[];
  /** デッキの組。アーティストごとの song_id 列 (表示順) */
  deck: string[][];
}

/**
 * JSON に載せていない列の既定値。UI はこれらを読まないが、既存コンポーネントの
 * props 型が songs 行そのものなので、形を合わせるために埋める。
 * 「取得していない」ことを表すので null / 0 / false 側に倒す。
 */
const OMITTED_COLUMN_DEFAULTS = {
  cert_label: null,
  cert_updated_at: null,
  created_at: "",
  updated_at: "",
  dam_request_no: null,
  fame_article: null,
  fame_updated_at: null,
  fame_views: null,
  itunes_preview_checked_at: null,
  itunes_track_id: null,
  last_spotify_attempt_at: null,
  match_status: "matched",
  original_release_year_check_details: null,
  original_release_year_check_status: null,
  original_release_year_checked_at: null,
  original_release_year_source: null,
  original_release_year_source_id: null,
  original_release_year_updated_at: null,
  source_urls: null,
  spotify_attempt_count: 0,
  spotify_explicit: null,
  spotify_isrc: null,
  spotify_preview_url: null,
  wikidata_qid: null,
  wikipedia_article: null,
} satisfies Omit<Song, GuestSongColumn>;

/** JSON レコードを songs 行の形に戻す */
export function toSong(record: GuestSongRecord): Song {
  const song = { ...OMITTED_COLUMN_DEFAULTS } as Song;
  for (const column of GUEST_SONG_COLUMNS) {
    // 列ごとに型が違うので、ここだけは代入時の型検査を外す。
    // GUEST_SONG_COLUMNS が keyof Song に閉じていることは上で保証済み。
    (song as Record<string, unknown>)[column] = record[column];
  }
  return song;
}

/** 曲がゲストに公開されているか (公開範囲外はログイン導線を出す) */
export function isGuestSong(
  songs: readonly GuestSongRecord[],
  songId: string,
): boolean {
  return songs.some((song) => song.id === songId);
}

/**
 * 評価済みの曲を組から落とす。空になった組ごと捨てる。
 *
 * ログイン中は推薦 RPC が評価済みを除外してくれるが、ゲストの評価は
 * localStorage にしかないのでサーバーは何も知らない。ゲストのデッキは
 * 表示前にここを通すこと。
 */
export function filterUnratedGroups(
  groups: readonly Song[][],
  ratedSongIds: ReadonlySet<string>,
): Song[][] {
  return groups
    .map((group) => group.filter((song) => !ratedSongIds.has(song.id)))
    .filter((group) => group.length > 0);
}

/**
 * 組の並びをシャッフルする (組の中身の順序は保つ)。
 * ゲストのデッキは固定 10 組で引き直す先が無いため、サイコロボタンは
 * 「残っている組を並べ替えて見せ直す」動きになる。
 */
export function shuffleGroups(groups: readonly Song[][]): Song[][] {
  const shuffled = [...groups];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

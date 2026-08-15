/**
 * ゲスト用固定曲リストの読み込み口 (サーバー専用)。
 *
 * JSON は 65KB あるのでクライアントバンドルに入れたくない。ゲスト向けページは
 * Server Component でここから読み、必要な分だけ props で渡すこと。
 * 型とヘルパーはクライアントからも使うので guest-songs.ts にある。
 */
import "server-only";

import guestSongsFile from "@/data/guest-songs.json";
import {
  type GuestSongRecord,
  type GuestSongsFile,
  toSong,
} from "@/lib/guest-songs";
import type { Database } from "@/types/database";

type Song = Database["public"]["Tables"]["songs"]["Row"];

const file = guestSongsFile as unknown as GuestSongsFile;

const byId = new Map(file.songs.map((song) => [song.id, song]));

/** ゲストに公開している全 70 曲 */
export function getGuestSongs(): GuestSongRecord[] {
  return file.songs;
}

/** ホームのレコードデッキ用の組 (10 アーティスト x 5 曲) */
export function getGuestDeckGroups(): Song[][] {
  return file.deck.map((ids) =>
    ids
      .map((id) => byId.get(id))
      .filter((song): song is GuestSongRecord => song != null)
      .map(toSong),
  );
}

/** id からゲスト公開曲を引く。公開範囲外なら null */
export function getGuestSong(songId: string): GuestSongRecord | null {
  return byId.get(songId) ?? null;
}

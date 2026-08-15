"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { DECK_COOKIE, DECK_COOKIE_OPTIONS, buildDeck } from "@/lib/deck";
import { findGuestSimilarSongs, toSong } from "@/lib/guest-songs";
import { getGuestSong, getGuestSongs } from "@/lib/guest-songs.server";
import { type SimilarSong, fetchSimilarSongs } from "@/lib/similar-songs";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Rating = Database["public"]["Enums"]["rating_type"];
type Song = Database["public"]["Tables"]["songs"]["Row"];

export interface RateSongInput {
  songId: string;
  rating: Rating;
}

export interface RateSongResult {
  ok: boolean;
  error?: string;
}

/**
 * 曲を評価する。同じ (user_id, song_id) で再評価したら上書き。
 */
export async function rateSong(input: RateSongInput): Promise<RateSongResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  const { error } = await supabase.from("evaluations").upsert(
    {
      user_id: user.id,
      song_id: input.songId,
      rating: input.rating,
    },
    { onConflict: "user_id,song_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  // ホーム ("/") は revalidate しない。force-dynamic でキャッシュが無く、
  // デッキはクライアントが保持しているので、再レンダーしても結果は捨てられる
  // (record-deck.tsx の groups は useState で initialGroups を差し替えない)。
  // ここで revalidate すると評価のたびに buildDeck が丸ごと走り直す。
  revalidatePath("/library");
  revalidatePath(`/songs/${input.songId}`);
  return { ok: true };
}

/**
 * 評価を取り消す (DELETE)。
 */
export async function unrateSong(songId: string): Promise<RateSongResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  const { error } = await supabase
    .from("evaluations")
    .delete()
    .eq("user_id", user.id)
    .eq("song_id", songId);

  if (error) {
    return { ok: false, error: error.message };
  }

  // ホームを revalidate しない理由は rateSong と同じ。
  revalidatePath("/library");
  revalidatePath(`/songs/${songId}`);
  return { ok: true };
}

/**
 * 「知らない / スキップ」を永続化する。rating='skip' で行を入れることで
 * 推薦関数 get_unrated_songs_v2 が TTL 20 日除外する。再スキップで TTL 延長。
 * 学習信号 (user_genre_distribution / user_artist_pref) は positive rating のみ
 * 参照しているので、ジャンル/アーティスト嗜好には影響しない。
 */
export async function markSkipped(songId: string): Promise<RateSongResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "認証が必要です" };
  }

  const { error } = await supabase.from("evaluations").upsert(
    {
      user_id: user.id,
      song_id: songId,
      rating: "skip",
    },
    { onConflict: "user_id,song_id" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  // skip は library/songs ページに表示されず、ホームも revalidate しない
  // (理由は rateSong を参照) ので、ここでは何も revalidate しない。
  return { ok: true };
}

export interface ShuffleDeckResult {
  ok: boolean;
  groups?: Song[][];
  error?: string;
}

/**
 * デッキを組み直す (サイコロボタン)。cookie を無視して新しいシードを引き、
 * その場で cookie も更新する。返した組をクライアントが差し替えるので、
 * 画面遷移や再読込は不要。
 */
export async function shuffleDeck(): Promise<ShuffleDeckResult> {
  const supabase = await createClient();
  const deck = await buildDeck(supabase, null);
  if (deck.groups.length === 0) {
    return {
      ok: false,
      error: deck.error ?? "他に推薦できる曲がありませんでした",
    };
  }
  if (deck.persistToken) {
    (await cookies()).set(DECK_COOKIE, deck.persistToken, DECK_COOKIE_OPTIONS);
  }
  return { ok: true, groups: deck.groups };
}

export interface SimilarSongsResult {
  ok: boolean;
  songs?: SimilarSong[];
  error?: string;
}

/**
 * デッキの詳細表示に出す「似た音域の楽曲」。
 *
 * 曲は 6 秒ごと / 評価ごとに変わるので、楽曲ページのように全評価を
 * ページ送りで舐める処理 (fetchRatedSimilarSongs) は使わない。音域で
 * 絞った 3 本のクエリだけで済む fetchSimilarSongs に寄せてある。
 *
 * ゲストは Supabase を叩けないので、公開 70 曲の中から音域が近い順に返す。
 * getGuestSong が公開範囲外を null にするので、ここから範囲外の曲が
 * 漏れることはない。
 */
export async function getSimilarSongs(
  songId: string,
  limit = 10,
): Promise<SimilarSongsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const target = getGuestSong(songId);
    if (!target) return { ok: true, songs: [] };
    return {
      ok: true,
      songs: findGuestSimilarSongs(getGuestSongs(), target, limit).map(toSong),
    };
  }

  const { data: song, error } = await supabase
    .from("songs")
    .select("id, artist_id, genres, range_low_midi, range_high_midi")
    .eq("id", songId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!song || song.range_low_midi == null || song.range_high_midi == null) {
    return { ok: true, songs: [] };
  }

  return {
    ok: true,
    songs: await fetchSimilarSongs(
      supabase,
      song.id,
      song.artist_id,
      song.genres,
      song.range_low_midi,
      song.range_high_midi,
      limit,
    ),
  };
}

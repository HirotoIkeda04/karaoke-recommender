"use client";

import { useMemo } from "react";

import { useGuestRatings } from "@/hooks/use-rating-actions";
import type { GuestSongRecord } from "@/lib/guest-songs";

import { LiveSearch } from "./live-search";

/**
 * ゲスト (未ログイン) の検索タブ。
 *
 * LiveSearch に公開 70 曲を渡してゲストモードにするのと、評価バッジの
 * 元データを localStorage から取ってくるのが仕事。
 */
export function GuestLiveSearch({ songs }: { songs: GuestSongRecord[] }) {
  const guestRatings = useGuestRatings();

  const ratings = useMemo(() => {
    const map: Record<string, string> = {};
    for (const [songId, entry] of Object.entries(guestRatings)) {
      map[songId] = entry.rating;
    }
    return map;
  }, [guestRatings]);

  return <LiveSearch ratings={ratings} guestSongs={songs} />;
}

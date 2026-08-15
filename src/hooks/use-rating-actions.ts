"use client";

import { useMemo, useSyncExternalStore } from "react";

import { useIsGuest } from "@/components/session-provider";
import {
  markSkipped,
  rateSong,
  unrateSong,
  type RateSongResult,
} from "@/app/(app)/actions";
import {
  getGuestRatingsSnapshot,
  getServerGuestRatings,
  removeGuestRating,
  setGuestRating,
  subscribeGuestRatings,
  type GuestRatingMap,
  type Rating,
} from "@/lib/guest-ratings";

export interface RatingActions {
  rateSong: (input: { songId: string; rating: Rating }) => Promise<RateSongResult>;
  unrateSong: (songId: string) => Promise<RateSongResult>;
  markSkipped: (songId: string) => Promise<RateSongResult>;
}

/**
 * 評価の保存先を「ログイン中なら Server Action / ゲストなら localStorage」で
 * 切り替える。呼び出し側は同じシグネチャで扱えるので、評価 UI は
 * ゲストかどうかを気にしなくてよい。
 */
export function useRatingActions(): RatingActions {
  const isGuest = useIsGuest();

  return useMemo<RatingActions>(() => {
    if (!isGuest) return { rateSong, unrateSong, markSkipped };

    return {
      rateSong: async ({ songId, rating }) => {
        setGuestRating(songId, rating);
        return { ok: true };
      },
      unrateSong: async (songId) => {
        removeGuestRating(songId);
        return { ok: true };
      },
      markSkipped: async (songId) => {
        setGuestRating(songId, "skip");
        return { ok: true };
      },
    };
  }, [isGuest]);
}

/**
 * ゲストの評価一覧を購読する。ログイン中は常に空を返すので、
 * 呼び出し側は isGuest の分岐なしに使える。
 */
export function useGuestRatings(): GuestRatingMap {
  const isGuest = useIsGuest();
  const ratings = useSyncExternalStore(
    subscribeGuestRatings,
    getGuestRatingsSnapshot,
    getServerGuestRatings,
  );
  return isGuest ? ratings : getServerGuestRatings();
}

/** サーバー (= ハイドレーション前) では null。localStorage を読めていない印 */
const unknownOnServer = () => null;

/**
 * useGuestRatings と同じだが、localStorage をまだ読めていない間は null を返す。
 *
 * 「評価済みを隠してから描く」画面 (ホームのデッキ) 用。空の map で先に
 * 描いてしまうと評価済みの曲が一瞬見えてしまうので、null の間は skeleton を
 * 出して待つ。
 */
export function useGuestRatingsWhenReady(): GuestRatingMap | null {
  return useSyncExternalStore(
    subscribeGuestRatings,
    getGuestRatingsSnapshot,
    unknownOnServer,
  );
}

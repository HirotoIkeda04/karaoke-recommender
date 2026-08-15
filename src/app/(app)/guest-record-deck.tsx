"use client";

import { useMemo } from "react";

import { useGuestRatingsWhenReady } from "@/hooks/use-rating-actions";
import { filterUnratedGroups } from "@/lib/guest-songs";
import type { Database } from "@/types/database";

import DeckSkeleton from "./loading";
import { RecordDeck } from "./record-deck";

type Song = Database["public"]["Tables"]["songs"]["Row"];

/**
 * ゲスト (未ログイン) のレコードデッキ。
 *
 * ゲストの評価は localStorage にしかないので、サーバーは「どの曲を評価済みか」
 * を知らない。組を RecordDeck に渡す前にここで評価済みを落とす。
 *
 * localStorage を読めるのはハイドレーション後なので、それまでは
 * ホームの skeleton を出して待つ。空の評価一覧で先に描いてしまうと、
 * 評価済みの曲が 1 フレーム見えてから飛ぶ。
 */
export function GuestRecordDeck({ groups }: { groups: Song[][] }) {
  const ratings = useGuestRatingsWhenReady();

  const unrated = useMemo(() => {
    if (ratings === null) return null;
    return filterUnratedGroups(groups, new Set(Object.keys(ratings)));
  }, [groups, ratings]);

  if (unrated === null) return <DeckSkeleton />;

  // 全部評価し切った状態も RecordDeck に任せる (空デッキのログイン導線を
  // 出す分岐が向こうにある)。
  return <RecordDeck initialGroups={unrated} persistToken={null} />;
}

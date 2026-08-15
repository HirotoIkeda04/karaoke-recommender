"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";

import { useGuestRatings } from "@/hooks/use-rating-actions";
import { buildGuestLibrary, type DisplayRating } from "@/lib/guest-library";
import type { GuestSongRecord } from "@/lib/guest-songs";

import { ProfileHeader } from "./profile-header";
import { RatingTabs } from "./rating-tabs";
import type { EvaluationRow } from "./sortable-list";

interface Props {
  /** ゲストに公開している曲 (src/data/guest-songs.json) */
  songs: GuestSongRecord[];
  initialTab: DisplayRating;
  minEasyForEstimate: number;
}

/**
 * ゲスト (未ログイン) のライブラリ。
 *
 * ログイン版が DB から引いている値を、localStorage の評価 + 公開 70 曲の
 * メタデータからそのまま組み立てる (計算は src/lib/guest-library.ts)。
 * 表示コンポーネント (ProfileHeader / RatingTabs) はログイン版と共通なので、
 * 見た目は揃う。
 *
 * フレンド数・Spotify 連携・プロフィール共有はアカウントが要るので出さない。
 */
export function GuestLibrary({ songs, initialTab, minEasyForEstimate }: Props) {
  const ratings = useGuestRatings();
  const library = useMemo(
    () => buildGuestLibrary(ratings, songs),
    [ratings, songs],
  );

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-4">
      {/* 「履歴が残らない」ことはゲストにとって一番効く情報なので最上部に置く */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
        <Info
          className="mt-px size-4 shrink-0 text-amber-700 dark:text-amber-300"
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-100">
            ログインしていないため、評価はこの端末のブラウザにだけ保存されます。
            ブラウザのデータを消したり別の端末で開いたりすると
            <span className="font-medium">履歴は残りません</span>。
          </p>
          <Link
            href="/login?next=%2Flibrary"
            className="inline-block rounded-full bg-amber-900 px-3 py-1 text-[11px] font-medium text-amber-50 hover:bg-amber-800 active:bg-amber-800 dark:bg-amber-100 dark:text-amber-950 dark:hover:bg-amber-200 dark:active:bg-amber-200"
          >
            ログインして履歴を残す
          </Link>
        </div>
      </div>

      <ProfileHeader
        displayName="ゲスト"
        iconColor={null}
        friendCount={0}
        ratedSongCount={library.ratedSongCount}
        voiceEstimate={library.voiceEstimate}
        eraBuckets={library.eraBuckets}
        genreBuckets={library.genreBuckets}
        minEasyForEstimate={minEasyForEstimate}
        viewMode="guest"
      />

      <RatingTabs
        evaluationsByRating={
          library.evaluationsByRating as Record<DisplayRating, EvaluationRow[]>
        }
        knownSongIds={[]}
        initialTab={initialTab}
      />
    </div>
  );
}

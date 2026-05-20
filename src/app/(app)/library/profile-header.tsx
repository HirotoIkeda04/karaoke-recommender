import Link from "next/link";

import type { GenreCode } from "@/lib/genres";
import { iconBackgroundStyle } from "@/lib/icon-color";
import { midiToKaraoke } from "@/lib/note";

import { SignOutButton } from "@/components/sign-out-button";

import { EraDistribution } from "./era-distribution";
import { FriendStatusButton } from "./friend-status-button";
import { GenreDistribution } from "./genre-distribution";
import { ShareProfileButton } from "./share-profile-button";

interface VoiceEstimate {
  comfortable_min_midi: number | null;
  comfortable_max_midi: number | null;
  falsetto_max_midi: number | null;
  easy_count: number | null;
}

interface Props {
  displayName: string;
  iconColor: string | null;
  friendCount: number;
  ratedSongCount: number;
  voiceEstimate: VoiceEstimate | null;
  eraBuckets: Record<number, number>;
  genreBuckets: Partial<Record<GenreCode, number>>;
  // 推定音域を表示するかの閾値判定用 (easy_count >= MIN_FOR_ESTIMATE のときのみ)
  minEasyForEstimate: number;
  // 'self' = 自分の library。'friend' = フレンド閲覧時 (編集/シェアボタン非表示)
  viewMode?: "self" | "friend";
  // viewMode='friend' のとき必須: 表示中のフレンドの user id
  friendUserId?: string;
}

// 表示名の頭文字を取り出す (絵文字や合字に対しても安全に 1 grapheme)
function firstGrapheme(name: string): string {
  if (!name) return "?";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const first = seg.segment(name)[Symbol.iterator]().next().value;
    if (first?.segment) return first.segment.toUpperCase();
  }
  return name.charAt(0).toUpperCase();
}

export function ProfileHeader({
  displayName,
  iconColor,
  friendCount,
  ratedSongCount,
  voiceEstimate,
  eraBuckets,
  genreBuckets,
  minEasyForEstimate,
  viewMode = "self",
  friendUserId,
}: Props) {
  const initial = firstGrapheme(displayName);
  const avatarStyle = iconBackgroundStyle(iconColor);
  const showEstimate =
    voiceEstimate &&
    (voiceEstimate.easy_count ?? 0) >= minEasyForEstimate &&
    voiceEstimate.comfortable_min_midi != null &&
    voiceEstimate.comfortable_max_midi != null;

  const rangeLabel = showEstimate
    ? `${midiToKaraoke(voiceEstimate.comfortable_min_midi)} 〜 ${midiToKaraoke(voiceEstimate.comfortable_max_midi)}`
    : null;

  const falsettoLabel =
    showEstimate && voiceEstimate.falsetto_max_midi != null
      ? `裏声 上限 ${midiToKaraoke(voiceEstimate.falsetto_max_midi)}`
      : null;

  const isSelf = viewMode === "self";

  return (
    <section className="space-y-4">
      {/* 上段: 名前 (左、大) + アバター (右、小)。
          スタッツは Instagram 風に名前のすぐ下の bio 1 行に muted で並べる */}
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate font-[family-name:var(--font-noto-serif-jp)] text-2xl font-medium text-zinc-900 dark:text-zinc-50">
            {displayName}
          </p>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="tabular-nums">{ratedSongCount}</span> 曲評価
            <span className="mx-1.5">·</span>
            <Link
              href="/friends"
              className="transition hover:text-zinc-700 active:text-zinc-700 dark:hover:text-zinc-200 dark:active:text-zinc-200"
            >
              <span className="tabular-nums">{friendCount}</span> フレンド
            </Link>
          </p>
        </div>
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold text-white"
          style={avatarStyle}
          aria-label={`${displayName} のアイコン`}
        >
          {initial}
        </div>
      </div>

      {/* bio: 推定音域 */}
      {rangeLabel ? (
        <div className="flex items-center gap-1.5">
          <h3 className="w-12 shrink-0 whitespace-nowrap text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
            推定音域
          </h3>
          <p className="min-w-0 flex-1 font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
            {rangeLabel}
            {falsettoLabel ? ` ・ ${falsettoLabel}` : ""}
          </p>
        </div>
      ) : isSelf ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
          「得意」評価が {minEasyForEstimate} 件以上で推定音域を表示します
        </p>
      ) : null}

      {/* 年代分布 */}
      <EraDistribution buckets={eraBuckets} />

      {/* ジャンル分布 (得意 / 練習中 / 普通 を集計) */}
      <GenreDistribution buckets={genreBuckets} />

      {/* アクションボタン */}
      {isSelf ? (
        <div className="flex items-center gap-2">
          <Link
            href="/profile/setup"
            className="flex-1 rounded-full bg-zinc-200 px-3 py-1.5 text-center text-[11px] font-medium text-zinc-700 hover:bg-zinc-300 active:bg-zinc-300 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:active:bg-zinc-800"
          >
            プロフィールを編集
          </Link>
          <ShareProfileButton />
          <SignOutButton />
        </div>
      ) : friendUserId ? (
        <div className="flex gap-2">
          <FriendStatusButton
            friendId={friendUserId}
            friendDisplayName={displayName}
          />
        </div>
      ) : null}
    </section>
  );
}

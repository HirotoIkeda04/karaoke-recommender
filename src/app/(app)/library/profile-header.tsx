import Link from "next/link";

import type { GenreCode } from "@/lib/genres";
import { midiToKaraoke } from "@/lib/note";

import { EraDistribution } from "./era-distribution";
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
  friendCount: number;
  ratedSongCount: number;
  voiceEstimate: VoiceEstimate | null;
  eraBuckets: Record<number, number>;
  genreBuckets: Partial<Record<GenreCode, number>>;
  // 推定音域を表示するかの閾値判定用 (easy_count >= MIN_FOR_ESTIMATE のときのみ)
  minEasyForEstimate: number;
  // 'self' = 自分の library。'friend' = フレンド閲覧時 (編集/シェアボタン非表示)
  viewMode?: "self" | "friend";
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
  friendCount,
  ratedSongCount,
  voiceEstimate,
  eraBuckets,
  genreBuckets,
  minEasyForEstimate,
  viewMode = "self",
}: Props) {
  const initial = firstGrapheme(displayName);
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
      {/* 上段: アバター + 表示名 / Insta 風の縦積みスタッツ */}
      <div className="flex items-start gap-4">
        <div
          className="flex size-20 shrink-0 items-center justify-center rounded-full bg-pink-500 text-3xl font-semibold text-white"
          aria-label={`${displayName} のアイコン`}
        >
          {initial}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {displayName}
          </p>

          <div className="flex items-start gap-6">
            <div className="flex flex-col items-center">
              <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {ratedSongCount}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                曲評価
              </span>
            </div>
            <Link
              href="/friends"
              className="flex flex-col items-center transition active:opacity-70"
            >
              <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {friendCount}
              </span>
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                フレンド
              </span>
            </Link>
          </div>
        </div>
      </div>

      {/* bio: 推定音域 */}
      {rangeLabel ? (
        <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
          推定音域 {rangeLabel}
          {falsettoLabel ? ` ・ ${falsettoLabel}` : ""}
        </p>
      ) : isSelf ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          「得意」評価が {minEasyForEstimate} 件以上で推定音域を表示します
        </p>
      ) : null}

      {/* アクションボタン (自分のみ表示) */}
      {isSelf ? (
        <div className="flex gap-2">
          <Link
            href="/profile/setup"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-center text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            プロフィールを編集
          </Link>
          <ShareProfileButton />
        </div>
      ) : null}

      {/* 年代分布 */}
      <EraDistribution buckets={eraBuckets} />

      {/* ジャンル分布 (得意 / 練習中 / 普通 を集計) */}
      <GenreDistribution buckets={genreBuckets} />
    </section>
  );
}

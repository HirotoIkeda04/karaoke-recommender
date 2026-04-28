import Link from "next/link";

import type { GenreCode } from "@/lib/genres";
import { midiToKaraoke } from "@/lib/note";

import { EraDistribution } from "./era-distribution";
import { GenreDistribution } from "./genre-distribution";

interface VoiceEstimate {
  comfortable_min_midi: number | null;
  comfortable_max_midi: number | null;
  falsetto_max_midi: number | null;
  easy_count: number | null;
}

interface Props {
  displayName: string;
  friendCount: number;
  voiceEstimate: VoiceEstimate | null;
  eraBuckets: Record<number, number>;
  genreBuckets: Partial<Record<GenreCode, number>>;
  // 推定音域を表示するかの閾値判定用 (easy_count >= MIN_FOR_ESTIMATE のときのみ)
  minEasyForEstimate: number;
}

// 表示名の頭文字を取り出す (絵文字や合字に対しても安全に 1 grapheme)
function firstGrapheme(name: string): string {
  if (!name) return "?";
  // Intl.Segmenter で grapheme 単位に分割
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
  voiceEstimate,
  eraBuckets,
  genreBuckets,
  minEasyForEstimate,
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

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      {/* 上段: アイコン + フレンド数 + 編集ボタン */}
      <div className="flex items-center gap-4">
        <div
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-pink-500 text-2xl font-semibold text-white"
          aria-label={`${displayName} のアイコン`}
        >
          {initial}
        </div>

        <Link
          href="/friends"
          className="flex flex-col items-center text-center transition active:opacity-70"
        >
          <span className="text-lg font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {friendCount}
          </span>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            フレンド
          </span>
        </Link>

        <div className="ml-auto">
          <Link
            href="/profile/setup"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            編集
          </Link>
        </div>
      </div>

      {/* 表示名 */}
      <div className="space-y-1">
        <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {displayName}
        </p>

        {/* 推定音域 (表示名の直下) */}
        {rangeLabel ? (
          <p className="font-mono text-xs text-zinc-600 dark:text-zinc-400">
            推定音域 {rangeLabel}
            {falsettoLabel ? ` ・ ${falsettoLabel}` : ""}
          </p>
        ) : (
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            「得意」評価が {minEasyForEstimate} 件以上で推定音域を表示します
          </p>
        )}
      </div>

      {/* 年代分布 */}
      <EraDistribution buckets={eraBuckets} />

      {/* ジャンル分布 (得意 / 練習中 / 普通 を集計) */}
      <GenreDistribution buckets={genreBuckets} />
    </section>
  );
}

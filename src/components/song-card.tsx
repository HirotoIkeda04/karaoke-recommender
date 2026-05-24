import { Check, Headphones, Minus, X } from "lucide-react";
import Link from "next/link";

import { DumbbellMini } from "@/components/icons/dumbbell-mini";
import { JacketImage } from "@/components/ui/jacket-image";
import { formatDuration, midiToKaraoke, noteChipColor } from "@/lib/note";
import type { Database } from "@/types/database";

type Song = Pick<
  Database["public"]["Tables"]["songs"]["Row"],
  | "id"
  | "title"
  | "artist"
  | "release_year"
  | "range_low_midi"
  | "range_high_midi"
  | "falsetto_max_midi"
  | "duration_ms"
  | "image_url_small"
  | "image_url_medium"
>;

const RATING_BADGE: Record<
  string,
  { label: string; color: string; Icon: typeof X }
> = {
  hard: {
    label: "苦手",
    color: "bg-red-600 dark:bg-red-500",
    Icon: X,
  },
  medium: {
    label: "普通",
    color: "bg-amber-600 dark:bg-amber-500",
    Icon: Minus,
  },
  easy: {
    label: "得意",
    color: "bg-emerald-600 dark:bg-emerald-500",
    Icon: Check,
  },
  practicing: {
    label: "練習中",
    color: "bg-purple-600 dark:bg-purple-500",
    Icon: DumbbellMini,
  },
};

interface SongCardProps {
  song: Song;
  rating?: string | null;
  /** Spotify で聴いたことがある曲かどうか (バッジ表示用) */
  isKnown?: boolean;
  /** false にすると曲詳細ページへのリンクを張らない (フレンドのライブラリ閲覧時など) */
  linkable?: boolean;
}

export function SongCard({
  song,
  rating,
  isKnown = false,
  linkable = true,
}: SongCardProps) {
  const badge = rating ? RATING_BADGE[rating] : null;
  const image = song.image_url_small ?? song.image_url_medium;
  const durationLabel = formatDuration(song.duration_ms);
  const highNote = song.range_high_midi;
  const noteChip =
    highNote != null
      ? {
          label: midiToKaraoke(highNote),
          ...noteChipColor(highNote),
        }
      : null;

  const Wrapper = linkable
    ? ({ children }: { children: React.ReactNode }) => (
        <Link
          href={`/songs/${song.id}`}
          className="flex items-center gap-3 rounded-md p-2 transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800/60"
        >
          {children}
        </Link>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div className="flex items-center gap-3 rounded-md p-2">
          {children}
        </div>
      );

  return (
    <Wrapper>
      <div className="relative size-12 shrink-0 overflow-hidden rounded-xs bg-white dark:bg-zinc-900">
        {image ? (
          <JacketImage
            src={image}
            alt=""
            fill
            sizes="3rem"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-lg text-zinc-400">
            ♪
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {/* タイトル行: 左 タイトル / 右 地声最高音チップ */}
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {song.title}
          </p>
          {noteChip ? (
            <span
              className="-mr-1 shrink-0 px-1 py-px text-[10px] font-semibold tabular-nums tracking-[-0.04em]"
              style={{
                backgroundColor: noteChip.background,
                color: noteChip.foreground,
                // TL TR BR BL = 3px 3px 3px 4px
                borderRadius: "3px 3px 3px 4px",
              }}
              aria-label={`地声最高音 ${noteChip.label}`}
            >
              {noteChip.label}
            </span>
          ) : null}
        </div>

        {/* アーティスト行: 左 評価アイコン + アーティスト名 / 右 曲長 */}
        <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <div className="flex min-w-0 flex-1 items-center gap-1">
            {badge ? (
              <span
                className={`inline-flex size-3 shrink-0 items-center justify-center rounded-full ${badge.color}`}
                aria-label={badge.label}
              >
                <badge.Icon
                  className="size-2 text-white dark:text-zinc-950"
                  strokeWidth={rating === "practicing" ? 2.5 : 4}
                  aria-hidden
                />
              </span>
            ) : null}
            {isKnown ? (
              <Headphones
                className="size-3 shrink-0 text-emerald-500"
                aria-label="Spotify で聴いたことがある曲"
              />
            ) : null}
            <p className="truncate">{song.artist}</p>
          </div>
          {durationLabel ? (
            // 色はアーティスト行 (text-zinc-600/400) を継承、サイズは 0.7rem。
            <span className="shrink-0 tabular-nums text-[0.7rem]">
              {durationLabel}
            </span>
          ) : null}
        </div>
      </div>
    </Wrapper>
  );
}

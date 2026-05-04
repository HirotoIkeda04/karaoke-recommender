import { Check, Dumbbell, Headphones, Minus, X } from "lucide-react";
import Link from "next/link";

import { JacketImage } from "@/components/ui/jacket-image";
import { midiToKaraoke } from "@/lib/note";
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
    Icon: Dumbbell,
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
      <div className="relative size-12 shrink-0 overflow-hidden rounded-sm bg-white dark:bg-zinc-900">
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
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {song.title}
        </p>
        <div className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
          {badge ? (
            <span
              className={`inline-flex size-2.5 shrink-0 items-center justify-center rounded-[2px] ${badge.color}`}
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
          <p className="truncate">
            {song.artist}
            {song.range_high_midi !== null
              ? ` · ~ ${midiToKaraoke(song.range_high_midi)}`
              : ""}
          </p>
        </div>
      </div>
    </Wrapper>
  );
}

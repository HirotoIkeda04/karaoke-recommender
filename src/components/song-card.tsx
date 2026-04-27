import Image from "next/image";
import Link from "next/link";

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

const RATING_BADGE: Record<string, { label: string; color: string }> = {
  hard: { label: "苦手", color: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  medium: { label: "普通", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200" },
  easy: { label: "得意", color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  practicing: { label: "練習中", color: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200" },
};

interface SongCardProps {
  song: Song;
  rating?: string | null;
}

export function SongCard({ song, rating }: SongCardProps) {
  const badge = rating ? RATING_BADGE[rating] : null;
  const image = song.image_url_small ?? song.image_url_medium;

  return (
    <Link
      href={`/songs/${song.id}`}
      className="flex items-center gap-3 rounded-md p-2 transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800/60"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-white dark:bg-zinc-900">
        {image ? (
          <Image
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
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {song.title}
          </p>
          {badge ? (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
          {song.artist}
          {song.range_high_midi !== null
            ? ` · ~ ${midiToKaraoke(song.range_high_midi)}`
            : ""}
        </p>
      </div>
    </Link>
  );
}

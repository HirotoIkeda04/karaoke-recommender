"use client";

import { useMemo, useState } from "react";

import { SongCard } from "@/components/song-card";
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
  | "image_url_large"
  | "fame_score"
  | "cert_score"
>;

interface Props {
  songs: Song[];
  ratings: Record<string, string>;
  knownIds: string[];
}

export function PopularList({ songs, ratings, knownIds }: Props) {
  const [expanded, setExpanded] = useState(false);
  const knownSet = useMemo(() => new Set(knownIds), [knownIds]);
  const visible = expanded ? songs : songs.slice(0, 5);
  const hasMore = songs.length > 5;

  return (
    <>
      <ul>
        {visible.map((s, idx) => (
          <li key={s.id} className="flex items-center">
            <span className="w-4 shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-100">
              {idx + 1}
            </span>
            <div className="min-w-0 flex-1">
              <SongCard
                song={s}
                rating={ratings[s.id] ?? null}
                isKnown={knownSet.has(s.id)}
              />
            </div>
          </li>
        ))}
      </ul>
      {hasMore ? (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500"
          >
            {expanded ? "閉じる" : "もっと見る"}
          </button>
        </div>
      ) : null}
    </>
  );
}

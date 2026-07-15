"use client";

import { useMemo, useState } from "react";

import { DecadeChips } from "@/components/decade-chips";
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
  | "duration_ms"
>;

interface DecadeFilterProps {
  songs: Song[];
  ratings: Record<string, string>;
  knownIds: string[];
}

export function DecadeFilter({ songs, ratings, knownIds }: DecadeFilterProps) {
  // 選択順を保持するため Set ではなく配列で管理する。
  // Spotify のように先頭から固まる順序付けに使う。
  const [selected, setSelected] = useState<number[]>([]);
  const knownSet = useMemo(() => new Set(knownIds), [knownIds]);

  const filtered = useMemo(() => {
    if (selected.length === 0) return songs;
    return songs.filter((s) => {
      const y = s.release_year;
      if (y == null) return false;
      for (const start of selected) {
        if (y >= start && y <= start + 9) return true;
      }
      return false;
    });
  }, [songs, selected]);

  const toggle = (start: number) => {
    setSelected((prev) =>
      prev.includes(start) ? prev.filter((s) => s !== start) : [...prev, start],
    );
  };

  return (
    <div className="space-y-3">
      <DecadeChips selected={selected} onToggle={toggle} />

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {selected.length === 0
          ? `全 ${songs.length.toLocaleString()} 曲`
          : `${filtered.length.toLocaleString()} 曲 (${selected.length} 年代を選択中)`}
      </p>

      {filtered.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
          選択中の年代に該当する楽曲はありません
        </p>
      ) : (
        <ul>
          {filtered.map((s) => (
            <li key={s.id}>
              <SongCard
                song={s}
                rating={ratings[s.id] ?? null}
                isKnown={knownSet.has(s.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

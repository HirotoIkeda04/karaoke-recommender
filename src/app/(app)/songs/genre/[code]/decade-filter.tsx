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
>;

interface DecadeFilterProps {
  songs: Song[];
  ratings: Record<string, string>;
  knownIds: string[];
}

// 10 年単位で区切る年代。新→旧の順に並べる (Spotify のフィルタチップ慣習)。
const DECADES: Array<{ label: string; start: number; end: number }> = [
  { label: "2020年代", start: 2020, end: 2029 },
  { label: "2010年代", start: 2010, end: 2019 },
  { label: "2000年代", start: 2000, end: 2009 },
  { label: "1990年代", start: 1990, end: 1999 },
  { label: "1980年代", start: 1980, end: 1989 },
];

export function DecadeFilter({ songs, ratings, knownIds }: DecadeFilterProps) {
  // 選択中の年代 (start 年の集合)。空 Set = フィルタ無し (全件表示)。
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const knownSet = useMemo(() => new Set(knownIds), [knownIds]);

  const filtered = useMemo(() => {
    if (selected.size === 0) return songs;
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
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      {/* チップ列: 横スクロール可能。Spotify のソートチップに近い見た目。
          選択中: bg-zinc-100/text-zinc-900 (= primary 白系)。
          未選択: ダーク背景に薄い枠線。 */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {DECADES.map((d) => {
          const active = selected.has(d.start);
          return (
            <button
              key={d.start}
              type="button"
              onClick={() => toggle(d.start)}
              aria-pressed={active}
              className={
                active
                  ? "shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 transition active:scale-95 dark:bg-zinc-50 dark:text-zinc-950"
                  : "shrink-0 rounded-full border border-zinc-300 bg-transparent px-3 py-1 text-xs font-medium text-zinc-700 transition active:scale-95 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {d.label}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {selected.size === 0
          ? `全 ${songs.length.toLocaleString()} 曲`
          : `${filtered.length.toLocaleString()} 曲 (${selected.size} 年代を選択中)`}
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

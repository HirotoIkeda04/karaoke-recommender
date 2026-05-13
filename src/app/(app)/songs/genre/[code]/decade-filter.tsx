"use client";

import { motion } from "framer-motion";
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
  // 選択順を保持するため Set ではなく配列で管理する。
  // Spotify のように先頭から固まる順序付けに使う。
  const [selected, setSelected] = useState<number[]>([]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

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

  // チップ並び: 選択中 (選択順) → 未選択 (元の DECADES 順)。
  // framer-motion の layout 属性が key を頼りに位置をアニメさせる。
  const ordered = useMemo(() => {
    const selectedChips = selected
      .map((start) => DECADES.find((d) => d.start === start))
      .filter((d): d is (typeof DECADES)[number] => Boolean(d));
    const unselectedChips = DECADES.filter((d) => !selectedSet.has(d.start));
    return [...selectedChips, ...unselectedChips];
  }, [selected, selectedSet]);

  return (
    <div className="space-y-3">
      {/* チップ列: 横スクロール可能。選択順に先頭に寄せて Spotify 風に「固まる」。 */}
      <motion.div
        layout
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ordered.map((d) => {
          const active = selectedSet.has(d.start);
          return (
            <motion.button
              key={d.start}
              layout
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
              type="button"
              onClick={() => toggle(d.start)}
              aria-pressed={active}
              className={
                active
                  ? "shrink-0 rounded-full bg-zinc-100 px-3 py-1 text-xs font-semibold text-zinc-900 active:scale-95 dark:bg-zinc-50 dark:text-zinc-950"
                  : "shrink-0 rounded-full border border-zinc-300 bg-transparent px-3 py-1 text-xs font-medium text-zinc-700 active:scale-95 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }
            >
              {d.label}
            </motion.button>
          );
        })}
      </motion.div>

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

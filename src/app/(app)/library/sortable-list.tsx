"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

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

type Rating = Database["public"]["Enums"]["rating_type"];

export interface EvaluationRow {
  rating: Rating;
  updated_at: string;
  song: Song | null;
}

interface SortableListProps {
  evaluations: EvaluationRow[];
  /** Spotify で聴いたことがある song_id リスト (バッジ表示用) */
  knownSongIds?: string[];
}

type SortKey = "updated" | "artist" | "release_year" | "range_high";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: ReadonlyArray<{
  key: SortKey;
  label: string;
  defaultDir: SortDir;
}> = [
  { key: "updated", label: "評価日", defaultDir: "desc" },
  { key: "artist", label: "アーティスト名", defaultDir: "asc" },
  { key: "release_year", label: "発売年", defaultDir: "desc" },
  { key: "range_high", label: "最高音", defaultDir: "desc" },
];

/** 2 行の比較結果 (asc 用)。dir は呼び出し側で反転する */
function compareEvaluation(
  a: EvaluationRow,
  b: EvaluationRow,
  key: SortKey,
): number {
  if (!a.song || !b.song) return 0;
  switch (key) {
    case "updated":
      return a.updated_at.localeCompare(b.updated_at);
    case "artist": {
      const c = a.song.artist.localeCompare(b.song.artist, "ja");
      return c !== 0 ? c : a.song.title.localeCompare(b.song.title, "ja");
    }
    case "release_year":
      return (
        (a.song.release_year ?? -Infinity) -
        (b.song.release_year ?? -Infinity)
      );
    case "range_high":
      return (
        (a.song.range_high_midi ?? -Infinity) -
        (b.song.range_high_midi ?? -Infinity)
      );
  }
}

export function SortableList({
  evaluations,
  knownSongIds = [],
}: SortableListProps) {
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);

  // ドロップダウンの click-outside 閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sorted = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...evaluations].sort(
      (a, b) => compareEvaluation(a, b, sortKey) * factor,
    );
  }, [evaluations, sortKey, sortDir]);

  const currentOption = SORT_OPTIONS.find((o) => o.key === sortKey)!;

  const handleSelect = (key: SortKey) => {
    if (key === sortKey) {
      // 同じ項目を選んだら方向を反転
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      // 別の項目に切り替え → そのデフォルト方向に
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find((o) => o.key === key)!.defaultDir);
    }
    setOpen(false);
  };

  return (
    <div className="space-y-3">
      {/* ソートヘッダ: 件数 (左) + 並び替えボタン (右) */}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-500">
        <span>{sorted.length} 曲</span>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <ArrowUpDown className="size-3.5" aria-hidden />
            <span>{currentOption.label}</span>
            {sortDir === "asc" ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            )}
          </button>

          {open ? (
            <div
              className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
              role="menu"
            >
              <ul className="py-1">
                {SORT_OPTIONS.map((option) => {
                  const selected = option.key === sortKey;
                  return (
                    <li key={option.key}>
                      <button
                        type="button"
                        onClick={() => handleSelect(option.key)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        role="menuitem"
                      >
                        <span className="flex items-center gap-2">
                          <Check
                            className={`size-3 ${
                              selected
                                ? "text-pink-600 dark:text-pink-400"
                                : "invisible"
                            }`}
                            aria-hidden
                          />
                          {option.label}
                        </span>
                        {selected ? (
                          sortDir === "asc" ? (
                            <ArrowUp
                              className="size-3 text-pink-600 dark:text-pink-400"
                              aria-hidden
                            />
                          ) : (
                            <ArrowDown
                              className="size-3 text-pink-600 dark:text-pink-400"
                              aria-hidden
                            />
                          )
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {/* 曲リスト */}
      <ul>
        {sorted.map((r) =>
          r.song ? (
            <li key={r.song.id}>
              <SongCard
                song={r.song}
                rating={r.rating}
                isKnown={knownSet.has(r.song.id)}
              />
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

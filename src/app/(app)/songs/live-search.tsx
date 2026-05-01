"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { SongCard } from "@/components/song-card";
import { karaokeToMidi } from "@/lib/note";
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

interface LiveSearchProps {
  songs: Song[];
  /** key: song_id, value: rating */
  ratings: Record<string, string>;
  /** Spotify で聴いたことがある song_id 一覧 */
  knownSongIds?: string[];
  /** DB 上の総楽曲数 (songs は PostgREST の 1000 行制限で頭打ちになりうるため別途渡す) */
  totalCount: number;
}

const HIGH_OPTIONS = [
  "",
  "mid2C",
  "mid2E",
  "mid2G",
  "hiA",
  "hiC",
  "hiD",
  "hiE",
  "hiF",
];

type SortKey = "artist" | "release_year" | "range_high";
type SortDir = "asc" | "desc";

const SORT_OPTIONS: ReadonlyArray<{
  key: SortKey;
  label: string;
  defaultDir: SortDir;
}> = [
  { key: "artist", label: "アーティスト名", defaultDir: "asc" },
  { key: "release_year", label: "発売年", defaultDir: "desc" },
  { key: "range_high", label: "最高音", defaultDir: "desc" },
];

/** asc 用の比較関数。dir は呼び出し側で反転 */
function compareSong(a: Song, b: Song, key: SortKey): number {
  switch (key) {
    case "artist": {
      const c = a.artist.localeCompare(b.artist, "ja");
      return c !== 0 ? c : a.title.localeCompare(b.title, "ja");
    }
    case "release_year":
      return (a.release_year ?? -Infinity) - (b.release_year ?? -Infinity);
    case "range_high":
      return (
        (a.range_high_midi ?? -Infinity) - (b.range_high_midi ?? -Infinity)
      );
  }
}

/** 検索文字列の正規化 (大小・全半・カタカナ/ひらがな等で揺れにくく) */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

export function LiveSearch({
  songs,
  ratings,
  knownSongIds = [],
  totalCount,
}: LiveSearchProps) {
  const [query, setQuery] = useState("");
  const [highMax, setHighMax] = useState("");
  const [highMin, setHighMin] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("artist");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // 入力を絶対遅らせないために、フィルタ計算側を deferred 値で動かす
  // (React 19 concurrent rendering: 高負荷フィルタ中もタイピングが詰まらない)
  const deferredQuery = useDeferredValue(query);

  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);

  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  const filtered = useMemo(() => {
    const normalizedQ = normalize(deferredQuery.trim());
    const highMaxMidi = highMax ? karaokeToMidi(highMax) : null;
    const highMinMidi = highMin ? karaokeToMidi(highMin) : null;

    let result = songs;
    if (normalizedQ) {
      result = result.filter((s) => {
        const t = normalize(s.title);
        const a = normalize(s.artist);
        return t.includes(normalizedQ) || a.includes(normalizedQ);
      });
    }
    if (highMaxMidi !== null) {
      result = result.filter(
        (s) => s.range_high_midi !== null && s.range_high_midi <= highMaxMidi,
      );
    }
    if (highMinMidi !== null) {
      result = result.filter(
        (s) => s.range_high_midi !== null && s.range_high_midi >= highMinMidi,
      );
    }
    const factor = sortDir === "asc" ? 1 : -1;
    return [...result].sort((a, b) => compareSong(a, b, sortKey) * factor);
  }, [songs, deferredQuery, highMax, highMin, sortKey, sortDir]);

  // 入力中はフィルタが追従中の体感を出す(deferredQuery と query がズレている間)
  const isStale = query !== deferredQuery;

  const currentSort = SORT_OPTIONS.find((o) => o.key === sortKey)!;

  const handleSelectSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find((o) => o.key === key)!.defaultDir);
    }
    setSortOpen(false);
  };

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="楽曲 / アーティストを検索する"
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg bg-zinc-100 px-3 py-2 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800 dark:placeholder:text-zinc-400"
      />

      {/* 範囲フィルタ: [下限] ≤ 最高音 ≤ [上限] という視覚的に直感的な配置 */}
      <div className="flex items-center gap-2 text-sm">
        <select
          value={highMin}
          onChange={(e) => setHighMin(e.target.value)}
          aria-label="最高音の下限"
          className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800"
        >
          {HIGH_OPTIONS.map((v) => (
            <option key={`min-${v}`} value={v}>
              {v || "—"}
            </option>
          ))}
        </select>
        <span className="shrink-0 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
          ≤ 最高音 ≤
        </span>
        <select
          value={highMax}
          onChange={(e) => setHighMax(e.target.value)}
          aria-label="最高音の上限"
          className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800"
        >
          {HIGH_OPTIONS.map((v) => (
            <option key={`max-${v}`} value={v}>
              {v || "—"}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-500">
        <span className={isStale ? "opacity-60" : undefined}>
          {filtered.length.toLocaleString()} 件 / 全{" "}
          {totalCount.toLocaleString()} 曲
        </span>
        <div ref={sortMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
          >
            <ArrowUpDown className="size-3.5" aria-hidden />
            <span>{currentSort.label}</span>
            {sortDir === "asc" ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            )}
          </button>

          {sortOpen ? (
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
                        onClick={() => handleSelectSort(option.key)}
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

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          該当する曲がありません
        </div>
      ) : (
        <ul className={isStale ? "opacity-70 transition-opacity" : undefined}>
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

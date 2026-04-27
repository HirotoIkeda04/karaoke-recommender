"use client";

import { useDeferredValue, useMemo, useState } from "react";

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

/** 検索文字列の正規化 (大小・全半・カタカナ/ひらがな等で揺れにくく) */
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC");
}

export function LiveSearch({ songs, ratings }: LiveSearchProps) {
  const [query, setQuery] = useState("");
  const [highMax, setHighMax] = useState("");
  const [highMin, setHighMin] = useState("");

  // 入力を絶対遅らせないために、フィルタ計算側を deferred 値で動かす
  // (React 19 concurrent rendering: 高負荷フィルタ中もタイピングが詰まらない)
  const deferredQuery = useDeferredValue(query);

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
    return result;
  }, [songs, deferredQuery, highMax, highMin]);

  // 入力中はフィルタが追従中の体感を出す(deferredQuery と query がズレている間)
  const isStale = query !== deferredQuery;

  const handleClear = () => {
    setQuery("");
    setHighMax("");
    setHighMin("");
  };

  const isFiltering = query.trim() !== "" || highMax !== "" || highMin !== "";

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
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-pink-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900"
      />

      {/* 範囲フィルタ: [下限] ≤ 最高音 ≤ [上限] という視覚的に直感的な配置 */}
      <div className="flex items-center gap-2 text-sm">
        <select
          value={highMin}
          onChange={(e) => setHighMin(e.target.value)}
          aria-label="最高音の下限"
          className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
          className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
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
          {filtered.length} 件
        </span>
        {isFiltering ? (
          <button
            type="button"
            onClick={handleClear}
            className="rounded px-2 py-1 text-xs text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-950"
          >
            クリア
          </button>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          該当する曲がありません
        </div>
      ) : (
        <ul className={isStale ? "opacity-70 transition-opacity" : undefined}>
          {filtered.map((s) => (
            <li key={s.id}>
              <SongCard song={s} rating={ratings[s.id] ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useMemo } from "react";

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

type Rating = Database["public"]["Enums"]["rating_type"];

export interface EvaluationRow {
  rating: Rating;
  updated_at: string;
  song: Song | null;
}

export type SortKey = "updated" | "range_high" | "release_year" | "artist";
export type SortDir = "asc" | "desc";

/** 並び順は項目ごとに固定 (YouTube のソートチップと同様に切り替えのみ) */
export const SORT_OPTIONS: ReadonlyArray<{
  key: SortKey;
  label: string;
  dir: SortDir;
}> = [
  { key: "updated", label: "評価日", dir: "desc" },
  { key: "range_high", label: "最高音", dir: "desc" },
  { key: "release_year", label: "発売年", dir: "desc" },
  { key: "artist", label: "アーティスト名", dir: "asc" },
];

interface SortableListProps {
  evaluations: EvaluationRow[];
  sortKey: SortKey;
  /** Spotify で聴いたことがある song_id リスト (バッジ表示用) */
  knownSongIds?: string[];
  /** false にすると曲行を曲詳細ページへリンクしない (フレンド閲覧時) */
  linkable?: boolean;
}

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
  sortKey,
  knownSongIds = [],
  linkable = true,
}: SortableListProps) {
  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);

  const sorted = useMemo(() => {
    const dir = SORT_OPTIONS.find((o) => o.key === sortKey)?.dir ?? "desc";
    const factor = dir === "asc" ? 1 : -1;
    return [...evaluations].sort(
      (a, b) => compareEvaluation(a, b, sortKey) * factor,
    );
  }, [evaluations, sortKey]);

  return (
    <ul>
      {sorted.map((r) =>
        r.song ? (
          <li key={r.song.id}>
            <SongCard
              song={r.song}
              rating={r.rating}
              isKnown={knownSet.has(r.song.id)}
              linkable={linkable}
            />
          </li>
        ) : null,
      )}
    </ul>
  );
}

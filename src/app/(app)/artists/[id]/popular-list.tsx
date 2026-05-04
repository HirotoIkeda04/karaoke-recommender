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

// Spotify 風の覗き見:
//   折りたたみ時は 6 番目 (idx=5) を mask gradient でフェードさせ、
//   「もっと見る」のヒントにする。展開時はマスクを外して全件表示。
const PEEK_INDEX = 5;
const PEEK_MASK =
  "[mask-image:linear-gradient(to_bottom,black_10%,transparent)] [-webkit-mask-image:linear-gradient(to_bottom,black_10%,transparent)]";

export function PopularList({ songs, ratings, knownIds }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pressed, setPressed] = useState(false);
  const knownSet = useMemo(() => new Set(knownIds), [knownIds]);
  const hasMore = songs.length > 5;

  // 押下アニメ → 少し遅れて展開、の順にしたいので setTimeout で間を空ける。
  const handleToggle = () => {
    if (pressed) return;
    setPressed(true);
    setTimeout(() => {
      setExpanded((v) => !v);
      setPressed(false);
    }, 80);
  };

  return (
    <>
      <ul>
        {songs.map((s, idx) => {
          const hidden = !expanded && idx > PEEK_INDEX;
          const peek = !expanded && idx === PEEK_INDEX;
          if (hidden) return null;
          return (
            <li
              key={s.id}
              className={`flex items-center ${peek ? PEEK_MASK : ""}`}
            >
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
          );
        })}
      </ul>
      {hasMore ? (
        <div className="mt-2 flex justify-center">
          <button
            type="button"
            onClick={handleToggle}
            className={`rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-semibold text-zinc-700 transition-transform duration-[20ms] hover:border-zinc-400 active:scale-90 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-500 ${pressed ? "scale-90" : ""}`}
          >
            {expanded ? "表示を減らす" : "もっと見る"}
          </button>
        </div>
      ) : null}
    </>
  );
}

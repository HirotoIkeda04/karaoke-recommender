"use client";

import { useState } from "react";

export interface RepertoireItem {
  songId: string;
  title: string;
  artist: string;
  imageUrl: string | null;
  // user_id の配列 (重複なし、guest は含まれない)
  singerIds: string[];
}

interface Props {
  repertoire: RepertoireItem[];
  totalUserParticipants: number;
  // user_id → display_name のマップ (singer 詳細表示用、現状は未使用だが将来の拡張用)
  profileMap: Record<string, string>;
}

type Filter = "all" | "majority" | "everyone";

const FILTER_LABEL: Record<Filter, string> = {
  all: "全て",
  majority: "半数以上",
  everyone: "全員",
};

export function RepertoireList({
  repertoire,
  totalUserParticipants,
  profileMap: _profileMap,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = repertoire.filter((item) => {
    if (filter === "everyone") {
      return (
        totalUserParticipants > 0 &&
        item.singerIds.length === totalUserParticipants
      );
    }
    if (filter === "majority") {
      return item.singerIds.length >= Math.ceil(totalUserParticipants / 2);
    }
    return true;
  });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          歌える曲 ({filtered.length})
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          得意 + 普通の和集合
        </p>
      </div>

      <div className="flex gap-1">
        {(["all", "majority", "everyone"] as const).map((f) => (
          <FilterChip
            key={f}
            active={filter === f}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABEL[f]}
          </FilterChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {totalUserParticipants === 0
            ? "認証ユーザーの参加がまだありません"
            : "条件に合う曲がありません"}
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {filtered.map((item) => (
            <li
              key={item.songId}
              className="flex items-center gap-3 px-3 py-2"
            >
              {item.imageUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={item.imageUrl}
                  alt=""
                  className="size-12 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="size-12 shrink-0 rounded bg-zinc-200 dark:bg-zinc-800" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {item.title}
                </p>
                <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {item.artist}
                </p>
              </div>
              <div className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {item.singerIds.length}/{totalUserParticipants}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
          : "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }
    >
      {children}
    </button>
  );
}

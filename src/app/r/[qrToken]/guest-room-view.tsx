"use client";

import { useState } from "react";

interface Participant {
  id: string;
  name: string;
  is_user: boolean;
  is_creator: boolean;
}

interface RepertoireItem {
  song_id: string;
  title: string;
  artist: string;
  image_url: string | null;
  singer_ids: string[];
  singer_count: number;
}

interface Props {
  participants: Participant[];
  repertoire: RepertoireItem[];
  totalUsers: number;
}

type Filter = "all" | "majority" | "everyone";

const FILTER_LABEL: Record<Filter, string> = {
  all: "全て",
  majority: "半数以上",
  everyone: "全員",
};

export function GuestRoomView({ participants, repertoire, totalUsers }: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = repertoire.filter((item) => {
    if (filter === "everyone") {
      return totalUsers > 0 && item.singer_count === totalUsers;
    }
    if (filter === "majority") {
      return item.singer_count >= Math.ceil(totalUsers / 2);
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">カラオケルーム</h1>

      <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        ゲストとして閲覧中。レパートリーへの追加には Google ログインが必要です
      </p>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          参加者 ({participants.length})
        </h2>
        <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          {participants.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 px-4 py-3"
            >
              <span className="flex-1 truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {p.name}
              </span>
              {p.is_creator ? (
                <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] font-medium text-pink-700 dark:bg-pink-950 dark:text-pink-300">
                  作成者
                </span>
              ) : null}
              {!p.is_user ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                  ゲスト
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            歌える曲 ({filtered.length})
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            得意 + 普通
          </p>
        </div>

        <div className="flex gap-1">
          {(["all", "majority", "everyone"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? "rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white dark:bg-zinc-50 dark:text-zinc-900"
                  : "rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            {totalUsers === 0
              ? "認証ユーザーの参加がまだありません"
              : "条件に合う曲がありません"}
          </p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
            {filtered.map((item) => (
              <li
                key={item.song_id}
                className="flex items-center gap-3 px-3 py-2"
              >
                {item.image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={item.image_url}
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
                  {item.singer_count}/{totalUsers}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

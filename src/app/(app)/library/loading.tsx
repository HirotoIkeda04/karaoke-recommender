/**
 * /library 遷移時の skeleton。
 * 4 タブ + 件数/ソート行 + SongCard 風のリスト 5 件を模す。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      {/* 4 タブ */}
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md bg-zinc-200/60 dark:bg-zinc-700/60"
          />
        ))}
      </div>

      {/* 件数 + ソートボタンの行 */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-6 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>

      {/* SongCard 風リスト */}
      <ul>
        {[0, 1, 2, 3, 4].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-md p-2"
          >
            <div className="size-14 shrink-0 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

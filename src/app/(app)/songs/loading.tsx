/**
 * /songs (検索) 遷移時の skeleton。
 * h1 + 検索フォーム + 件数 + リスト 5 件。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      {/* 検索フォーム */}
      <div className="space-y-2">
        <div className="h-10 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-9 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-9 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />

      <ul className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <li
            key={i}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="size-14 shrink-0 animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

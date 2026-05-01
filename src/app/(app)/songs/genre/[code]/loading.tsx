/**
 * /songs/genre/[code] 遷移時の skeleton。
 * ヘッダー (戻る + タイトル) + アーティスト行 8 件。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      <div className="flex items-center gap-2">
        <div className="size-9 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-5 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="ml-auto h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>

      <ul>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li key={i} className="flex items-center gap-3 rounded-md p-2">
            <div className="size-12 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

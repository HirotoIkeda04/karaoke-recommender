/**
 * /profile/setup 遷移時の skeleton。
 * 戻る + タイトル + 説明文 + ユーザーネーム + アイコン色 (avatar + 9列パレット) + 保存ボタン。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md p-6"
      role="status"
      aria-label="読み込み中"
    >
      <div className="mb-4">
        <div className="-ml-2 size-9 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>

      <div className="mb-6 space-y-2">
        <div className="h-7 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3.5 w-4/5 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      <div className="space-y-8">
        {/* ユーザーネーム */}
        <div className="space-y-1.5">
          <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-10 w-full animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-3 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* アイコンの色 (h2 + プレビュー + 9 列パレット) */}
        <div className="space-y-3">
          <div className="h-5 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex items-center gap-3">
            <div className="size-16 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="space-y-1.5">
              <div className="h-3 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-3 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          </div>
          <div className="grid grid-cols-9 gap-2">
            {Array.from({ length: 18 }).map((_, i) => (
              <div
                key={i}
                className="aspect-square animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
              />
            ))}
          </div>
        </div>

        {/* 保存ボタン */}
        <div className="h-11 w-full animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

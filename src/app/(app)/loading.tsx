/**
 * ホーム (/) 遷移時の skeleton。
 * SwipeDeck の構造を模した: 中央のカード + 戻る/スキップ + 4 評価ボタン。
 *
 * 子ルートで loading.tsx が定義されている場合はそちらが優先される。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-6"
      role="status"
      aria-label="読み込み中"
    >
      {/* カード */}
      <div className="relative h-[26rem] w-full">
        <div className="absolute inset-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex h-full flex-col items-center justify-between gap-3">
            <div className="aspect-square w-full max-w-[14rem] animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="w-full space-y-2 text-center">
              <div className="mx-auto h-5 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="mx-auto h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <div className="h-7 w-32 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-12 w-full animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
          </div>
        </div>
      </div>

      {/* 戻る / スキップ行 */}
      <div className="flex w-full items-center justify-between">
        <div className="h-8 w-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-8 w-36 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* 4 評価ボタン */}
      <div className="grid w-full grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800"
          />
        ))}
      </div>
    </div>
  );
}

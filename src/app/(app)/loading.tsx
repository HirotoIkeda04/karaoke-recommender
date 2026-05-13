/**
 * ホーム (/) 遷移時の skeleton。
 * SwipeDeck の構造を模した: 22:30 比率カード + 4 評価ボタン + スキップ/戻る行。
 *
 * 子ルートで loading.tsx が定義されている場合はそちらが優先される。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-5 overflow-hidden px-4 py-6"
      role="status"
      aria-label="読み込み中"
    >
      {/* カード: swipe-deck と同じ aspect-ratio / width formula */}
      <div
        className="relative"
        style={{
          aspectRatio: "22 / 30",
          width:
            "min(22rem, calc((100svh - 23rem - env(safe-area-inset-bottom)) * 22 / 30))",
        }}
      >
        <div
          className="absolute inset-0 animate-pulse bg-zinc-200 shadow-sm dark:bg-zinc-800"
          style={{
            clipPath: "inset(0 round 16px)",
            WebkitClipPath: "inset(0 round 16px)",
          }}
        />
      </div>

      {/* 4 評価ボタン (丸 size-14 + ラベル) */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="size-14 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>

      {/* スキップ (col-span-3) + 戻る (size-14) */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        <div className="col-span-3 -mx-1 h-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="mx-auto size-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

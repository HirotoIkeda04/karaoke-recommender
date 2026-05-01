/**
 * /artists/[id] (詳細) 遷移時の skeleton。
 * フルブリードヒーロー + ジャンルチップ + 人気楽曲 + 全楽曲リスト。
 */
export default function Loading() {
  return (
    <div className="pb-8" role="status" aria-label="読み込み中">
      <div className="aspect-square w-full animate-pulse bg-zinc-200 dark:bg-zinc-800" />

      <div className="mx-auto max-w-md space-y-6 px-4 pt-5">
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-6 w-16 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>

        <section className="space-y-2">
          <div className="h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-2"
            >
              <div className="size-12 shrink-0 animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

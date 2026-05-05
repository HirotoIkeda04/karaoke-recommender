/**
 * /artists/[id] (詳細) 遷移時の skeleton。
 * フルブリードヒーロー (aspect-square + 戻るオーバーレイ + 名前下端) +
 * ジャンルチップ + 人気の楽曲 + 全楽曲 + 関連アーティスト横スクロール。
 */
export default function Loading() {
  return (
    <div className="pb-8" role="status" aria-label="読み込み中">
      {/* ヒーロー画像 */}
      <div className="relative aspect-[4/3] w-full animate-pulse bg-zinc-200 dark:bg-zinc-800">
        {/* 戻るボタン (オーバーレイ) */}
        <div className="absolute left-3 top-3 size-9 rounded-full bg-black/30 sm:left-4 sm:top-4" />
        {/* 名前 + 曲数 */}
        <div className="absolute inset-x-0 bottom-0 space-y-1.5 px-4 pb-5 sm:px-6">
          <div className="h-9 w-2/3 rounded bg-zinc-100/40 dark:bg-zinc-700/40" />
          <div className="h-4 w-20 rounded bg-zinc-100/40 dark:bg-zinc-700/40" />
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-6 px-4 pt-5">
        {/* ジャンルチップ */}
        <div className="flex flex-wrap gap-1.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-6 w-16 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800"
            />
          ))}
        </div>

        {/* 人気の楽曲 */}
        <section>
          <div className="mb-2 h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <ul>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 p-2">
                <div className="size-12 shrink-0 animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 全楽曲 */}
        <section>
          <div className="mb-2 h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <ul>
            {[0, 1, 2, 3, 4].map((i) => (
              <li key={i} className="flex items-center gap-3 p-2">
                <div className="size-12 shrink-0 animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* 関連アーティスト (横スクロール、丸アバター + 名前) */}
        <section>
          <div className="mb-3 h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <ul className="-mx-4 flex gap-3 overflow-hidden px-4 pb-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="w-28 shrink-0">
                <div className="size-28 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
                <div className="mx-auto mt-2 h-3 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/**
 * /library 遷移時の skeleton。
 * Insta 風プロフィールヘッダー (アバター + 4 col スタッツ + 推定音域 + 年代/ジャンル分布 + 編集/シェア) +
 * 4 タブ (下線スタイル) + ソート行 + SongCard リスト 5 件。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      {/* プロフィールヘッダー */}
      <section className="space-y-4">
        {/* 上段: アバター + スタッツ */}
        <div className="flex items-start gap-4">
          <div className="size-20 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="ml-[5%] h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="grid grid-cols-4 items-center pt-1">
              {[0, 1].map((i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                  <div className="h-3 w-10 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                </div>
              ))}
              <div />
              <div className="col-start-4 flex justify-center">
                <div className="size-8 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
              </div>
            </div>
          </div>
        </div>

        {/* 推定音域 / 年代分布 / ジャンル分布: 左 16px ラベル + 右 1fr 内容 */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className="h-3 w-16 shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-4 min-w-0 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}

        {/* 編集 / シェア ボタン */}
        <div className="flex gap-2">
          <div className="h-7 flex-1 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-7 w-10 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </section>

      {/* 4 タブ (下線スタイル) */}
      <div className="grid grid-cols-4 border-b border-zinc-200 dark:border-zinc-800">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-1 px-2 py-3"
          >
            <div className="size-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-6 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        ))}
      </div>

      {/* ソート行 */}
      <div className="flex items-center justify-between">
        <div className="h-6 w-28 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>

      {/* SongCard リスト */}
      <ul>
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="flex items-center gap-3 rounded-md p-2">
            <div className="size-12 shrink-0 animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />
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

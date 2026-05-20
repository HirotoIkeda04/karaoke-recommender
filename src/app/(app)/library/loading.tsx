/**
 * /library 遷移時の skeleton。実 UI (profile-header / era-distribution /
 * genre-distribution / rating-tabs / sortable-list) のレイアウトと
 * 揃えるためのプレースホルダー。
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
        {/* 上段: 名前+bio (左) + アバター (右, size-14) */}
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {/* name (text-2xl ≒ h-7) */}
            <div className="h-7 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            {/* bio "N 曲評価 · M フレンド" */}
            <div className="h-3 w-36 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="size-14 shrink-0 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* 推定音域: w-12 label + flex-1 値 */}
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-12 shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>

        {/* 年代分布: w-12 label + バー (h-6), 凡例 (w-12 spacer + flex-1) */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-12 shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-6 min-w-0 flex-1 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="flex gap-1.5">
            <div className="w-12 shrink-0" aria-hidden />
            <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>

        {/* ジャンル: 年代分布と同形 */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <div className="h-3 w-12 shrink-0 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-6 min-w-0 flex-1 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="flex gap-1.5">
            <div className="w-12 shrink-0" aria-hidden />
            <div className="h-3 min-w-0 flex-1 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>

        {/* アクション: 編集 (flex-1) + シェア (flex-1) + サインアウト (h-8 アイコン) */}
        <div className="flex items-center gap-2">
          <div className="h-7 flex-1 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="h-7 flex-1 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
          <div className="size-8 shrink-0 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        </div>
      </section>

      {/* 4 タブ (アイコン + ラベル, gap-0.5 py-3) */}
      <div className="grid grid-cols-4 border-b border-zinc-200 dark:border-zinc-800">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex flex-col items-center gap-0.5 py-3"
          >
            <div className="size-4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
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
            <div className="size-12 shrink-0 animate-pulse rounded-xs bg-zinc-200 dark:bg-zinc-800" />
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

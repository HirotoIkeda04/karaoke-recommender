/**
 * /songs/[id] (詳細) 遷移時の skeleton。
 * 大きいジャケ + 曲名/アー名 + 音域 + 評価コントロール + メモ + Spotify ボタン。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-5 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      {/* 大きいジャケット */}
      <div className="aspect-square w-full animate-pulse rounded-2xl bg-zinc-200 dark:bg-zinc-800" />

      {/* 曲名 + アーティスト */}
      <div className="space-y-2">
        <div className="h-7 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      </div>

      {/* 音域情報 */}
      <div className="h-20 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />

      {/* 評価ボタン (4 択) */}
      <div className="grid grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl bg-zinc-200 dark:bg-zinc-800"
          />
        ))}
      </div>

      {/* メモ入力 */}
      <div className="h-24 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />

      {/* Spotify ボタン */}
      <div className="h-11 w-full animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800" />
    </div>
  );
}

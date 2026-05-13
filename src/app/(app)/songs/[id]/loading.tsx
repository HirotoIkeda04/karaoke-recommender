/**
 * /songs/[id] (詳細) 遷移時の skeleton。
 * 中央寄せの小さめジャケ + 曲名/アー名 + 評価 + Spotify ボタン + 楽曲情報カード。
 */
export default function Loading() {
  return (
    <div
      className="relative mx-auto max-w-md space-y-5 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      <div className="space-y-2">
        {/* ジャケット (3/5 幅, max 14rem, 中央寄せ) */}
        <div className="mx-auto mt-2 aspect-square w-3/5 max-w-[14rem] animate-pulse rounded-sm bg-zinc-200 dark:bg-zinc-800" />

        {/* 曲名 + アーティスト (中央寄せ) */}
        <div className="space-y-2 text-center">
          <div className="mx-auto h-7 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="mx-auto h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      {/* 評価コントロール + Spotify ボタン */}
      <div className="flex items-center justify-center gap-3">
        <div className="h-11 w-44 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="size-11 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>

      {/* 楽曲情報 section */}
      <section className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mx-4 space-y-0 rounded-xl bg-zinc-100 dark:bg-zinc-800/60">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-baseline gap-3 px-6 py-3"
              style={{
                borderTop: i === 0 ? undefined : "1px solid transparent",
              }}
            >
              <div className="h-4 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

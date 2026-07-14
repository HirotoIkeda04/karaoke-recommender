/**
 * /songs/[id] (詳細) 遷移時の skeleton。
 * 中央寄せの小さめジャケ + 曲名/アー名 + 評価 + Spotify ボタン + 楽曲情報カード。
 */
export default function Loading() {
  return (
    <div
      className="relative mx-auto max-w-md space-y-5 px-4 pb-4 pt-[var(--song-detail-top-padding,1rem)]"
      role="status"
      aria-label="読み込み中"
    >
      <div className="mx-5 flex items-center gap-4">
        {/* ジャケット (最大 6.5rem, 左寄せ) */}
        <div className="aspect-square w-[28%] max-w-[6.5rem] shrink-0 animate-pulse rounded-xs bg-zinc-200 dark:bg-zinc-800" />

        {/* 曲名 + アーティスト (右側、左寄せ) */}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-7 w-3/4 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        </div>
      </div>

      {/* 評価・再生・歌詞ボタン */}
      <div className="-mr-4 ml-4 flex gap-2 overflow-hidden pr-4">
        {["w-24", "w-28", "w-28"].map((width, i) => (
          <div
            key={i}
            className={`h-9 ${width} shrink-0 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800`}
          />
        ))}
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

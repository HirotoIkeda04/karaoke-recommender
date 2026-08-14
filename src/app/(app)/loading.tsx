/**
 * ホーム (/) 遷移時の skeleton。
 * RecordDeck の構造を模した: レコード盤 (円) + 曲情報 + 4 評価ボタン +
 * スキップ 2 種/戻る行。円のサイズ式は record-deck.tsx の DISC_SIZE と揃える。
 *
 * 子ルートで loading.tsx が定義されている場合はそちらが優先される。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-6 overflow-hidden px-4 pb-2 pt-8"
      role="status"
      aria-label="読み込み中"
    >
      {/* 組ごとのカルーセル (サムネイル行) */}
      <div className="flex h-14 w-full items-center justify-center gap-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`animate-pulse bg-zinc-200 dark:bg-zinc-800 ${
              i === 1 ? "size-14" : "size-11"
            }`}
          />
        ))}
      </div>

      {/* レコード盤 */}
      <div
        className="animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800"
        style={{
          width:
            "min(20rem, calc(100vw - 3.5rem), max(8rem, calc(100svh - 32.75rem - env(safe-area-inset-bottom))))",
          aspectRatio: "1 / 1",
        }}
      />

      {/* 曲順 + 楽曲名 / アーティスト名 */}
      <div className="flex w-full flex-col items-center gap-2">
        <div className="h-6 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="h-4 w-28 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
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

      {/* スキップ 2 種 + 戻る */}
      <div className="grid w-full grid-cols-[1fr_1fr_3.5rem] items-center gap-3">
        <div className="h-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="h-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
        <div className="mx-auto size-14 animate-pulse rounded-full bg-zinc-100 dark:bg-zinc-800" />
      </div>
    </div>
  );
}

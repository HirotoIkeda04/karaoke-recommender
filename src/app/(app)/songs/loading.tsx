/**
 * /songs (検索) 遷移時の skeleton。
 * 検索バー + ブラウズ用ジャンルカードグリッド (2 列, aspect 16/10) を模す。
 */
export default function Loading() {
  return (
    <div
      className="mx-auto max-w-md space-y-4 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      {/* 検索バー */}
      <div className="h-9 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />

      {/* ブラウズを開始 見出し */}
      <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />

      {/* ジャンルカードグリッド */}
      <ul className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <li
            key={i}
            className="aspect-square animate-pulse rounded-lg bg-zinc-200 dark:bg-zinc-800"
          />
        ))}
      </ul>
    </div>
  );
}

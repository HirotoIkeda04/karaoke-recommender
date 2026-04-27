/**
 * /profile 遷移時の skeleton。
 * 推定音域 section + 評価統計 (棒グラフ) section を模す。
 */
export default function Loading() {
  // 棒グラフのバーの幅を予め決めておく(表示時のジャンプを最小化)
  const barWidths = ["60%", "40%", "30%", "20%"];

  return (
    <div
      className="mx-auto max-w-md space-y-5 px-4 py-4"
      role="status"
      aria-label="読み込み中"
    >
      <div className="h-6 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />

      {/* 推定音域 */}
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex justify-between">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-20 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </section>

      {/* 評価統計 */}
      <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <ul className="space-y-2">
          {barWidths.map((width, i) => (
            <li key={i} className="space-y-1">
              <div className="flex justify-between">
                <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
                <div className="h-3 w-12 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full animate-pulse rounded-full bg-zinc-300 dark:bg-zinc-700"
                  style={{ width }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

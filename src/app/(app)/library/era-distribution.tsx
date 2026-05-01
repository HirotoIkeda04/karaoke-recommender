import { BarChart, orangeShadeColor } from "./bar-chart";

interface Props {
  // decade (e.g. 1980) → count
  buckets: Record<number, number>;
}

function decadeLabel(decade: number) {
  return `'${String(decade).slice(-2)}s`;
}

export function EraDistribution({ buckets }: Props) {
  const decades = Object.keys(buckets)
    .map(Number)
    .filter((d) => buckets[d] > 0)
    .sort((a, b) => b - a);

  const total = decades.reduce((sum, d) => sum + buckets[d], 0);

  if (total === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
          年代分布
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          評価済みの楽曲がまだありません
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="w-28 shrink-0 text-right text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
          年代分布
        </h3>
        <div className="min-w-0 flex-1">
          <BarChart
            segments={decades.map((decade, i) => {
              const count = buckets[decade];
              const pct = (count / total) * 100;
              return {
                key: String(decade),
                value: count,
                colorClass: orangeShadeColor(i),
                title: `${decadeLabel(decade)}: ${count}曲 (${pct.toFixed(0)}%)`,
              };
            })}
          />
        </div>
      </div>

      {/* 凡例 (件数 0 の年代は表示しない) — バー開始位置に揃える */}
      <div className="flex gap-3">
        <div className="w-28 shrink-0" aria-hidden />
        <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {decades.map((decade, i) => (
            <li key={decade} className={orangeShadeColor(i)}>
              {decadeLabel(decade)} ({buckets[decade]})
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

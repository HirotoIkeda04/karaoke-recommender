import { BarChart, redShadeColor } from "./bar-chart";

interface Props {
  // decade (e.g. 1980) → count
  buckets: Record<number, number>;
}

function decadeLabel(decade: number) {
  return `${decade}s`;
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
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          楽曲の年代分布
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          評価済みの楽曲がまだありません
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        楽曲の年代分布
      </h3>

      <BarChart
        segments={decades.map((decade, i) => {
          const count = buckets[decade];
          const pct = (count / total) * 100;
          return {
            key: String(decade),
            value: count,
            colorClass: redShadeColor(i),
            title: `${decadeLabel(decade)}: ${count}曲 (${pct.toFixed(0)}%)`,
          };
        })}
      />

      {/* 凡例 (件数 0 の年代は表示しない) */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {decades.map((decade, i) => (
          <li
            key={decade}
            className={redShadeColor(i)}
          >
            {decadeLabel(decade)} ({buckets[decade]})
          </li>
        ))}
      </ul>
    </section>
  );
}

import { PieChart } from "./pie-chart";

interface Props {
  // decade (e.g. 1980) → count
  buckets: Record<number, number>;
}

// 各 decade に対応する Tailwind 色クラス (彩度を抑えた muted トーン)
const DECADE_COLORS: Record<number, { bar: string; text: string }> = {
  1960: { bar: "bg-violet-400/60", text: "text-violet-400/60" },
  1970: { bar: "bg-indigo-400/60", text: "text-indigo-400/60" },
  1980: { bar: "bg-sky-400/60", text: "text-sky-400/60" },
  1990: { bar: "bg-emerald-400/60", text: "text-emerald-400/60" },
  2000: { bar: "bg-amber-400/60", text: "text-amber-400/60" },
  2010: { bar: "bg-orange-400/60", text: "text-orange-400/60" },
  2020: { bar: "bg-pink-400/60", text: "text-pink-400/60" },
};

const FALLBACK_COLOR = {
  bar: "bg-zinc-400/60",
  text: "text-zinc-400/60",
};

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

      <div className="flex items-center gap-4">
        <PieChart
          size={80}
          segments={decades.map((decade) => {
            const count = buckets[decade];
            const pct = (count / total) * 100;
            const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
            return {
              key: String(decade),
              value: count,
              colorClass: color.text,
              title: `${decadeLabel(decade)}: ${count}曲 (${pct.toFixed(0)}%)`,
            };
          })}
        />

        {/* 凡例 (件数 0 の年代は表示しない) */}
        <ul className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {decades.map((decade) => {
            const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
            return (
              <li key={decade} className={color.text}>
                {decadeLabel(decade)} ({buckets[decade]})
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

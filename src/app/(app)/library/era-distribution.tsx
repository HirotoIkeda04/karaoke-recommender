import { allocateDots, DotGrid } from "./dot-grid";

interface Props {
  // decade (e.g. 1980) → count
  buckets: Record<number, number>;
}

// 各 decade に対応する Tailwind 色クラス (連続した色相で並ぶよう選定)
const DECADE_COLORS: Record<number, { bar: string; text: string }> = {
  1960: { bar: "bg-violet-500", text: "text-violet-500" },
  1970: { bar: "bg-indigo-500", text: "text-indigo-500" },
  1980: { bar: "bg-sky-500", text: "text-sky-500" },
  1990: { bar: "bg-emerald-500", text: "text-emerald-500" },
  2000: { bar: "bg-amber-500", text: "text-amber-500" },
  2010: { bar: "bg-orange-500", text: "text-orange-500" },
  2020: { bar: "bg-pink-500", text: "text-pink-500" },
};

const FALLBACK_COLOR = {
  bar: "bg-zinc-500",
  text: "text-zinc-500",
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

      {/* 10×2 のドットで割合を表現 (上段→下段の順に左から埋める) */}
      <DotGrid
        segments={allocateDots(
          decades.map((decade) => {
            const count = buckets[decade];
            const pct = (count / total) * 100;
            const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
            return {
              key: String(decade),
              count,
              colorClass: color.bar,
              title: `${decadeLabel(decade)}: ${count}曲 (${pct.toFixed(0)}%)`,
            };
          }),
        )}
      />

      {/* 凡例 (件数 0 の年代は表示しない) */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {decades.map((decade) => {
          const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
          return (
            <li key={decade} className={color.text}>
              {decadeLabel(decade)} ({buckets[decade]})
            </li>
          );
        })}
      </ul>
    </section>
  );
}

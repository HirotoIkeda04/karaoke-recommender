interface Props {
  // decade (e.g. 1980) → count
  buckets: Record<number, number>;
}

// 各 decade に対応する Tailwind 色クラス (連続した色相で並ぶよう選定)
const DECADE_COLORS: Record<number, { bar: string; chip: string; ring: string }> = {
  1960: {
    bar: "bg-violet-500",
    chip: "bg-violet-500",
    ring: "ring-violet-500/20",
  },
  1970: {
    bar: "bg-indigo-500",
    chip: "bg-indigo-500",
    ring: "ring-indigo-500/20",
  },
  1980: {
    bar: "bg-sky-500",
    chip: "bg-sky-500",
    ring: "ring-sky-500/20",
  },
  1990: {
    bar: "bg-emerald-500",
    chip: "bg-emerald-500",
    ring: "ring-emerald-500/20",
  },
  2000: {
    bar: "bg-amber-500",
    chip: "bg-amber-500",
    ring: "ring-amber-500/20",
  },
  2010: {
    bar: "bg-orange-500",
    chip: "bg-orange-500",
    ring: "ring-orange-500/20",
  },
  2020: {
    bar: "bg-pink-500",
    chip: "bg-pink-500",
    ring: "ring-pink-500/20",
  },
};

const FALLBACK_COLOR = {
  bar: "bg-zinc-500",
  chip: "bg-zinc-500",
  ring: "ring-zinc-500/20",
};

function decadeLabel(decade: number) {
  return `${decade}s`;
}

export function EraDistribution({ buckets }: Props) {
  const decades = Object.keys(buckets)
    .map(Number)
    .filter((d) => buckets[d] > 0)
    .sort((a, b) => a - b);

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

      {/* 1本のスタックバー */}
      <div className="flex h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {decades.map((decade) => {
          const count = buckets[decade];
          const pct = (count / total) * 100;
          const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
          return (
            <div
              key={decade}
              className={color.bar}
              style={{ width: `${pct}%` }}
              title={`${decadeLabel(decade)}: ${count}曲 (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>

      {/* 凡例 (件数 0 の年代は表示しない) */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {decades.map((decade) => {
          const color = DECADE_COLORS[decade] ?? FALLBACK_COLOR;
          return (
            <li key={decade} className="inline-flex items-center gap-1">
              <span
                className={`size-2 rounded-full ${color.chip}`}
                aria-hidden
              />
              {decadeLabel(decade)} ({buckets[decade]})
            </li>
          );
        })}
      </ul>
    </section>
  );
}

import { GENRE_LABELS, type GenreCode } from "@/lib/genres";

import { BarChart, tealShadeColor } from "./bar-chart";

interface Props {
  // genre code → 評価済み曲数 (easy + medium + practicing)
  buckets: Partial<Record<GenreCode, number>>;
}

// 累積割合がこの閾値に達するまでをドットグリッド上で個別表示し、
// 残りの少数派ジャンルは1つの「他のジャンル」にまとめる。
const TOP_THRESHOLD = 0.9;

const REST_COLOR_CLASS = "text-zinc-400/60";
const REST_LABEL = "他のジャンル";

export function GenreDistribution({ buckets }: Props) {
  const entries = (Object.entries(buckets) as [GenreCode, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]); // 件数降順

  const total = entries.reduce((sum, [, c]) => sum + c, 0);

  if (total === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
          楽曲のジャンル分布
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          「得意 / 練習中 / 普通」評価がまだありません
        </p>
      </section>
    );
  }

  // 累積 90% に達するまでを top, 残りを rest に分割
  // 1件目は必ず top に入る (累積 0 < 0.9 のため)
  const top: [GenreCode, number][] = [];
  const rest: [GenreCode, number][] = [];
  let cumulative = 0;
  for (const entry of entries) {
    if (cumulative < TOP_THRESHOLD) {
      top.push(entry);
      cumulative += entry[1] / total;
    } else {
      rest.push(entry);
    }
  }
  const restCount = rest.reduce((sum, [, c]) => sum + c, 0);
  const restPct = (restCount / total) * 100;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-3">
        <h3 className="w-28 shrink-0 text-right text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
          楽曲のジャンル分布
        </h3>
        <div className="min-w-0 flex-1">
          <BarChart
            segments={[
              ...top.map(([code, count], i) => {
                const pct = (count / total) * 100;
                return {
                  key: code,
                  value: count,
                  colorClass: tealShadeColor(i),
                  title: `${GENRE_LABELS[code]}: ${count}曲 (${pct.toFixed(0)}%)`,
                };
              }),
              ...(restCount > 0
                ? [
                    {
                      key: "rest",
                      value: restCount,
                      colorClass: REST_COLOR_CLASS,
                      title: `${REST_LABEL}: ${restCount}曲 (${restPct.toFixed(0)}%) — ${rest
                        .map(([code, c]) => `${GENRE_LABELS[code]} ${c}`)
                        .join(", ")}`,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="w-28 shrink-0" aria-hidden />
        <ul className="flex min-w-0 flex-1 flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {top.map(([code, count], i) => (
            <li key={code} className={tealShadeColor(i)}>
              {GENRE_LABELS[code]} ({count})
            </li>
          ))}
          {restCount > 0 && (
            <li
              className={REST_COLOR_CLASS}
              title={rest
                .map(([code, c]) => `${GENRE_LABELS[code]} ${c}`)
                .join(", ")}
            >
              {REST_LABEL} ({restCount})
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}

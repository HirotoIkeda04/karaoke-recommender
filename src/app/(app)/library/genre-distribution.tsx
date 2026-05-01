import { GENRE_LABELS, type GenreCode } from "@/lib/genres";

import { PieChart } from "./pie-chart";

interface Props {
  // genre code → 評価済み曲数 (easy + medium + practicing)
  buckets: Partial<Record<GenreCode, number>>;
}

// ジャンル毎の Tailwind 配色 (ドットグリッド + 凡例文字色で共有 / 彩度を抑えた muted トーン)
const GENRE_COLORS: Record<GenreCode, { bar: string; text: string }> = {
  j_pop: { bar: "bg-pink-400/60", text: "text-pink-400/60" },
  j_rock: { bar: "bg-red-400/60", text: "text-red-400/60" },
  anison: { bar: "bg-orange-400/60", text: "text-orange-400/60" },
  vocaloid_utaite: { bar: "bg-cyan-400/60", text: "text-cyan-400/60" },
  idol_female: { bar: "bg-rose-400/60", text: "text-rose-400/60" },
  idol_male: { bar: "bg-blue-400/60", text: "text-blue-400/60" },
  rnb_soul: { bar: "bg-amber-400/60", text: "text-amber-400/60" },
  hiphop: { bar: "bg-purple-400/60", text: "text-purple-400/60" },
  enka_kayo: { bar: "bg-yellow-400/60", text: "text-yellow-400/60" },
  western: { bar: "bg-emerald-400/60", text: "text-emerald-400/60" },
  kpop: { bar: "bg-fuchsia-400/60", text: "text-fuchsia-400/60" },
  game_bgm: { bar: "bg-indigo-400/60", text: "text-indigo-400/60" },
  other: { bar: "bg-zinc-400/60", text: "text-zinc-400/60" },
};

// 累積割合がこの閾値に達するまでをドットグリッド上で個別表示し、
// 残りの少数派ジャンルは1つの「他のジャンル」にまとめる。
const TOP_THRESHOLD = 0.9;

const REST_COLOR = { bar: "bg-zinc-400/60", text: "text-zinc-400/60" };
const REST_LABEL = "他のジャンル";

export function GenreDistribution({ buckets }: Props) {
  const entries = (Object.entries(buckets) as [GenreCode, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]); // 件数降順

  const total = entries.reduce((sum, [, c]) => sum + c, 0);

  if (total === 0) {
    return (
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          歌える曲のジャンル分布
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
      <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        歌える曲のジャンル分布
      </h3>

      <div className="relative w-fit">
        <PieChart
          size={240}
          innerRatio={0.85}
          segments={[
            ...top.map(([code, count]) => {
              const pct = (count / total) * 100;
              const color = GENRE_COLORS[code];
              return {
                key: code,
                value: count,
                colorClass: color.text,
                title: `${GENRE_LABELS[code]}: ${count}曲 (${pct.toFixed(0)}%)`,
              };
            }),
            ...(restCount > 0
              ? [
                  {
                    key: "rest",
                    value: restCount,
                    colorClass: REST_COLOR.text,
                    title: `${REST_LABEL}: ${restCount}曲 (${restPct.toFixed(0)}%) — ${rest
                      .map(([code, c]) => `${GENRE_LABELS[code]} ${c}`)
                      .join(", ")}`,
                  },
                ]
              : []),
          ]}
        />

        {/* 凡例 — ドーナツ中央のホールに重ねる */}
        <ul className="pointer-events-none absolute inset-0 m-auto grid grid-cols-2 content-center justify-items-start gap-x-3 gap-y-0.5 px-12 text-[11px]">
          {top.map(([code, count]) => {
            const color = GENRE_COLORS[code];
            return (
              <li key={code} className={color.text}>
                {GENRE_LABELS[code]} ({count})
              </li>
            );
          })}
          {restCount > 0 && (
            <li
              className={REST_COLOR.text}
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

// 10列×2行 (合計 20 個) のドットで割合を表現するための小道具。
//
// 充填順は画像 (上→下) ではなく「横並びの上段→下段」。
// すなわち grid 上の番号付けが
//   1  3  5  7  9  11 13 15 17 19
//   2  4  6  8  10 12 14 16 18 20
// で、埋める順番は 1,3,...,19 → 2,4,...,20。
// CSS Grid の auto-flow=row + grid-cols-10 grid-rows-2 とすると
// 子要素が上段→下段の順に配置されるためこの順番と一致する。

const TOTAL_DOTS = 20;

export interface DotInput {
  key: string;
  count: number;
  colorClass: string;
  title?: string;
}

export interface DotSegment {
  key: string;
  dots: number;
  colorClass: string;
  title?: string;
}

// 各カテゴリの件数から 20 個の枠の取り分を整数で算出する。
// 合計が 20 になるよう "最大剰余法" で残りを配分し、いずれの値も整数 (= 5% の倍数) になるようにする。
export function allocateDots(inputs: DotInput[]): DotSegment[] {
  const total = inputs.reduce((sum, e) => sum + e.count, 0);
  if (total === 0) {
    return inputs.map((e) => ({
      key: e.key,
      dots: 0,
      colorClass: e.colorClass,
      title: e.title,
    }));
  }

  const raw = inputs.map((e) => {
    const rawDots = (e.count / total) * TOTAL_DOTS;
    const floored = Math.floor(rawDots);
    return {
      key: e.key,
      dots: floored,
      colorClass: e.colorClass,
      title: e.title,
      remainder: rawDots - floored,
      count: e.count,
    };
  });

  let assigned = raw.reduce((sum, e) => sum + e.dots, 0);
  const order = raw
    .map((e, i) => ({ i, remainder: e.remainder, count: e.count }))
    .sort((a, b) => b.remainder - a.remainder || b.count - a.count);

  let idx = 0;
  while (assigned < TOTAL_DOTS && idx < order.length) {
    raw[order[idx].i].dots += 1;
    assigned += 1;
    idx += 1;
  }

  return raw.map(({ key, dots, colorClass, title }) => ({
    key,
    dots,
    colorClass,
    title,
  }));
}

interface DotGridProps {
  segments: DotSegment[];
}

export function DotGrid({ segments }: DotGridProps) {
  const cells: { key: string; colorClass: string; title?: string }[] = [];
  for (const seg of segments) {
    for (let i = 0; i < seg.dots; i++) {
      cells.push({
        key: `${seg.key}-${i}`,
        colorClass: seg.colorClass,
        title: seg.title,
      });
    }
  }
  while (cells.length < TOTAL_DOTS) {
    cells.push({
      key: `empty-${cells.length}`,
      colorClass: "bg-zinc-200 dark:bg-zinc-800",
    });
  }

  return (
    <div className="grid w-fit grid-cols-10 grid-rows-2 gap-1">
      {cells.map((c) => (
        <span
          key={c.key}
          className={`size-2 rounded-full ${c.colorClass}`}
          title={c.title}
          aria-hidden
        />
      ))}
    </div>
  );
}

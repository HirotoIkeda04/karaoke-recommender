// 20列×2行 (合計 40 個) のドットで割合を表現するための小道具。
//
// 充填順は「横から敷き詰める」= 列ごとに左から右へ進める。
// グリッド上の番号付けは
//   1  3  5  ... 39
//   2  4  6  ... 40
// で、左端の列から順に上→下→次の列…と埋めていく。
//
// レイアウトは横幅いっぱい (両端揃い)。flex の justify-between により
// 最左列がコンテナ左端、最右列がコンテナ右端に揃う。

const COLS = 20;
const ROWS = 2;
const TOTAL_DOTS = COLS * ROWS;

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

// 各カテゴリの件数から 40 個の枠の取り分を整数で算出する。
// 合計が 40 になるよう "最大剰余法" で残りを配分し、各値は整数 (= 2.5% の倍数) になる。
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

  // 列ごとに [上, 下] の 2 ドットへグルーピング (左の列から順に塗られる)
  const columns: { key: string; colorClass: string; title?: string }[][] = [];
  for (let c = 0; c < COLS; c++) {
    columns.push([cells[c * ROWS], cells[c * ROWS + 1]]);
  }

  return (
    <div className="flex w-full justify-between">
      {columns.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-1">
          {col.map((c) => (
            <span
              key={c.key}
              className={`size-2 rounded-full ${c.colorClass}`}
              title={c.title}
              aria-hidden
            />
          ))}
        </div>
      ))}
    </div>
  );
}

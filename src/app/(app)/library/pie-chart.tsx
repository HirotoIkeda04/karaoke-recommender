// SVG ベースの円グラフ。色は `text-*` クラス + `fill-current` で渡す。

export interface PieSegment {
  key: string;
  value: number;
  colorClass: string; // 例: "text-pink-400/60"
  title?: string;
}

interface PieChartProps {
  segments: PieSegment[];
  size?: number;
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
) {
  const start = polar(cx, cy, r, startAngle);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function PieChart({ segments, size = 80 }: PieChartProps) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  // 単一セグメント: 円を直接描画 (パスだと閉じない)
  if (segments.filter((s) => s.value > 0).length === 1) {
    const only = segments.find((s) => s.value > 0)!;
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="shrink-0"
      >
        <circle
          cx="50"
          cy="50"
          r="48"
          className={`fill-current ${only.colorClass}`}
        >
          {only.title ? <title>{only.title}</title> : null}
        </circle>
      </svg>
    );
  }

  let acc = 0;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0">
      {segments.map((seg) => {
        if (seg.value <= 0) return null;
        const startAngle = (acc / total) * 360;
        acc += seg.value;
        const endAngle = (acc / total) * 360;
        const d = arcPath(50, 50, 48, startAngle, endAngle);
        return (
          <path
            key={seg.key}
            d={d}
            className={`fill-current ${seg.colorClass}`}
          >
            {seg.title ? <title>{seg.title}</title> : null}
          </path>
        );
      })}
    </svg>
  );
}

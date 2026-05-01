// 横向きの積み上げバー。色は `text-*` クラス + `bg-current` で塗る。
// 10% ごとに細い境界線を重ねる。

// 同系色のシェードグラデーション。先頭(index=0)が最も濃く、後ろほど淡くなる。
const RED_SHADES = [
  "text-red-600",
  "text-red-500",
  "text-red-400",
  "text-red-300",
  "text-red-200",
];

const BLUE_SHADES = [
  "text-blue-600",
  "text-blue-500",
  "text-blue-400",
  "text-blue-300",
  "text-blue-200",
];

export function redShadeColor(index: number): string {
  return RED_SHADES[Math.min(index, RED_SHADES.length - 1)];
}

export function blueShadeColor(index: number): string {
  return BLUE_SHADES[Math.min(index, BLUE_SHADES.length - 1)];
}

export interface BarSegment {
  key: string;
  value: number;
  colorClass: string; // 例: "text-pink-400/60"
  title?: string;
}

interface BarChartProps {
  segments: BarSegment[];
}

const GRIDLINES = [10, 20, 30, 40, 50, 60, 70, 80, 90];

export function BarChart({ segments }: BarChartProps) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  return (
    <div className="relative h-3 w-full overflow-hidden rounded-sm">
      <div className="flex h-full">
        {segments.map((seg) => {
          if (seg.value <= 0) return null;
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={seg.key}
              style={{ width: `${pct}%` }}
              className={`h-full bg-current ${seg.colorClass}`}
              title={seg.title}
            />
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-0">
        {GRIDLINES.map((p) => (
          <div
            key={p}
            className="absolute top-0 h-full w-px bg-white/30 dark:bg-zinc-950/40"
            style={{ left: `${p}%` }}
          />
        ))}
      </div>
    </div>
  );
}

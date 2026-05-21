import { forwardRef, type SVGProps } from "react";

/**
 * 「練習中」評価用のミニマルダンベル。
 *
 * lucide-react の Dumbbell は両端それぞれにプレート 4 枚 + バーで計 ~14 線分
 * となり、X / Check / Minus (線 1〜2 本) と並べた時に視覚的に重くなっていた。
 * 両端 1 プレート + バーの 3 図形に簡略化して 4 ボタンの密度を揃える。
 *
 * lucide と同じ ForwardRef 形にしてあるので Icon: Dumbbell からの直接差替が可能
 * (`Icon: typeof X` 等の型に collateral なく入る)。
 */
export const DumbbellMini = forwardRef<
  SVGSVGElement,
  SVGProps<SVGSVGElement>
>(function DumbbellMini({ strokeWidth = 2, ...props }, ref) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {/* 中心 (12,12) 基準で -45° 回転させ、左下→右上の斜めダンベルに */}
      <g transform="rotate(-45 12 12)">
        <rect x="4" y="7" width="3" height="10" rx="0.5" />
        <rect x="17" y="7" width="3" height="10" rx="0.5" />
        <line x1="7" y1="12" x2="17" y2="12" />
      </g>
    </svg>
  );
});

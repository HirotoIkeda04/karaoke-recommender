"use client";

import { forwardRef, useId, type SVGProps } from "react";

/**
 * iTunes Store のマーク (星に連桁の八分音符を抜いた形)。
 *
 * iOS の iTunes Store アプリのアイコンに倣って星形にしてある。同じ行に
 * 並ぶ Spotify / Apple Music のマークと重さを揃えるため、あちらと同じ
 * 「currentColor で塗った図形から音符を mask で抜く」作りにした。
 *
 * 星は外接半径 11.6 / 内接半径 5.6 の 5 芒星 (頂点は真上から 72° ごと)。
 * 音符は丸より狭い星の内側に収めるため、Apple Music のマークの 58% まで
 * 縮めて、星の重心寄り (12, 10.8) に置いている。
 * mask の id はページ内で衝突しないよう useId から採る。
 */
export const ItunesMark = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function ItunesMark(props, ref) {
    const maskId = `itunes-mark-${useId()}`;
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        {...props}
      >
        <mask id={maskId}>
          <rect width="24" height="24" fill="white" />
          {/* 音符。Apple Music のマークと同じ形を縮めて置いている */}
          <g fill="black" transform="translate(5.42 3.55) scale(0.58)">
            <path d="M9.3 8.2 17.1 6.6 17.1 9.2 9.3 10.8Z" />
            <rect x="9.3" y="8.2" width="1.5" height="8.2" />
            <rect x="15.6" y="6.6" width="1.5" height="7.6" />
            <ellipse cx="8.1" cy="16.4" rx="2.5" ry="2.1" />
            <ellipse cx="14.4" cy="14.2" rx="2.5" ry="2.1" />
          </g>
        </mask>
        <path
          d="M12.00 0.40 15.29 7.47 23.03 8.42 17.33 13.73 18.82 21.38 12.00 17.60 5.18 21.38 6.67 13.73 0.97 8.42 8.71 7.47Z"
          mask={`url(#${maskId})`}
        />
      </svg>
    );
  },
);

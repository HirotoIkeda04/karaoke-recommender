"use client";

import { forwardRef, useId, type SVGProps } from "react";

/**
 * Apple Music のマーク (丸に連桁の八分音符を抜いた形)。
 *
 * lucide にブランドアイコンは無いので手で組んである。Spotify のマークと
 * 並ぶので、あちらと同じ「currentColor で塗った丸」に揃えた。音符は
 * mask で抜いているので、チップの地の色が何であれそのまま透ける。
 * mask の id はページ内で衝突しないよう useId から採る。
 * iTunes Store 側は星形の [[ItunesMark]] (itunes-mark.tsx)。
 */
export const AppleMusicMark = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function AppleMusicMark(props, ref) {
    const maskId = `apple-music-mark-${useId()}`;
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
          <g fill="black">
            {/* 連桁 (2 本の符幹の頭をつなぐ帯) */}
            <path d="M9.3 8.2 17.1 6.6 17.1 9.2 9.3 10.8Z" />
            {/* 符幹 */}
            <rect x="9.3" y="8.2" width="1.5" height="8.2" />
            <rect x="15.6" y="6.6" width="1.5" height="7.6" />
            {/* 符頭 (符幹の左下に付く) */}
            <ellipse cx="8.1" cy="16.4" rx="2.5" ry="2.1" />
            <ellipse cx="14.4" cy="14.2" rx="2.5" ry="2.1" />
          </g>
        </mask>
        <circle cx="12" cy="12" r="12" mask={`url(#${maskId})`} />
      </svg>
    );
  },
);

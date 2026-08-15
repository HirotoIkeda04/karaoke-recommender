"use client";

/**
 * ボトムナビの見た目とノブ調整用の開発ルート。
 * /liquid-glass 配下なので未ログインで開け、本番では proxy.ts が 404 にする。
 *
 * かつては lens (屈折レンズ) / goo (液体) / both の 3 案を並べて比較していたが、
 * goo 採用が決まったので lens と both は撤去した。残しているのは
 * 「ログインせずに本番と同じ見た目を実機で確認し、goo のノブを詰める」ため。
 *
 * ここは app-bottom-nav.tsx の写しなので、寸法・色・ノブを触るときは
 * 必ず両方を揃えること。ずれると「調整した値が本番に効いていない」という
 * 一番たちの悪い勘違いが起きる。
 */

import { Liquid } from "liquid-gooey";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import { useState } from "react";

import { GlassSurface } from "@/components/ui/glass-surface";

const TAB_ITEMS = [
  { label: "評価", icon: Home },
  { label: "ライブラリ", icon: LibraryBig },
  { label: "ルーム", icon: Users },
];

// --- ここから下は app-bottom-nav.tsx と同じ値 ---
const BAR_H = 64;
const LABEL_PX = 12;
const PILL_H = 48;
const PILL_R = 24;
const PILL_INSET_X = 6;
const SPLIT_GAP_PX = 8;
const CSS_MOVE = "transform .52s cubic-bezier(.34,1.36,.42,1)";
/** goo の fill は必ず不透明色。alpha' = 20a - 7.83 なので半透明だと消える。 */
const GOO_FILL = "#3f3f42";
const MOVE_KNOBS = {
  springiness: 0.5,
  wobble: 0.6,
  stretch: 0.5,
  trail: 0.7,
};

const SWATCHES = [
  "linear-gradient(135deg,#f43f5e,#f59e0b)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
  "linear-gradient(135deg,#06b6d4,#3b82f6)",
  "linear-gradient(135deg,#22c55e,#84cc16)",
  "linear-gradient(135deg,#eab308,#f97316)",
  "linear-gradient(135deg,#6366f1,#06b6d4)",
];

export default function NavLabPage() {
  // -1 = 検索が現在地 (カプセル内にインジケータが無い状態)
  const [active, setActive] = useState(0);
  const searchActive = active < 0;

  return (
    <div className="min-h-dvh bg-background pb-40">
      <div className="space-y-2 p-3">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className="size-14 shrink-0 rounded-md"
              style={{ background: SWATCHES[i % SWATCHES.length] }}
            />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                サンプル楽曲 {i + 1} — Sample Track
              </div>
              <div className="text-xs text-zinc-400">アーティスト名 · ~ hiF</div>
            </div>
          </div>
        ))}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4">
        <div
          className="pointer-events-auto mx-auto flex max-w-md items-center"
          style={{
            height: BAR_H,
            gap: SPLIT_GAP_PX,
            marginBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          {/* 行き先のタブ (くっつく側) */}
          <div className="relative h-full flex-1 rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]">
            <GlassSurface variant="bar" radius={9999} />
            <Liquid
              blur={8}
              contrast={20}
              fill={GOO_FILL}
              filterPadding={40}
              style={{ position: "relative", height: "100%" }}
            >
              {active >= 0 ? (
                <Liquid.Item effect="move" move={MOVE_KNOBS}>
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: (BAR_H - PILL_H) / 2,
                      left: PILL_INSET_X,
                      width: `calc(${100 / TAB_ITEMS.length}% - ${PILL_INSET_X * 2}px)`,
                      height: PILL_H,
                      borderRadius: PILL_R,
                      transform: `translateX(calc(${active} * (100% + ${PILL_INSET_X * 2}px)))`,
                      transition: CSS_MOVE,
                    }}
                  />
                </Liquid.Item>
              ) : null}

              <ul className="grid h-full grid-cols-3 items-center">
                {TAB_ITEMS.map((item, i) => {
                  const Icon = item.icon;
                  const isActive = i === active;
                  return (
                    <li key={item.label} className="min-w-0">
                      <button
                        type="button"
                        onClick={() => setActive(i)}
                        aria-current={isActive ? "page" : undefined}
                        className={`flex w-full flex-col items-center justify-center gap-[3px] px-1 ${
                          isActive ? "text-white" : "text-zinc-400"
                        }`}
                      >
                        <Icon className="size-6" aria-hidden />
                        <span
                          className="max-w-full truncate text-[10px] font-medium"
                          style={{ lineHeight: `${LABEL_PX}px` }}
                        >
                          {item.label}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Liquid>
          </div>

          {/* 検索 (離れる側)。ラベルを持たない単独の円ボタン。 */}
          <button
            type="button"
            onClick={() => setActive(-1)}
            aria-label="検索"
            aria-current={searchActive ? "page" : undefined}
            className={`relative flex shrink-0 items-center justify-center rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)] ${
              searchActive ? "text-white" : "text-zinc-400"
            }`}
            style={{ width: BAR_H, height: BAR_H }}
          >
            <GlassSurface variant="bar" radius={9999} />
            {searchActive ? (
              <span
                aria-hidden
                className="absolute rounded-full"
                style={{ inset: PILL_INSET_X, background: GOO_FILL }}
              />
            ) : null}
            <Search className="relative size-6" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

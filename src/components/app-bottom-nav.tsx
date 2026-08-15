"use client";

import { motion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";

import { GlassSurface } from "@/components/ui/glass-surface";
import { triggerHaptic } from "@/lib/haptics";
import { isSongSheetOpen } from "@/lib/song-sheet-route";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/songs", label: "検索", icon: Search },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/rooms", label: "ルーム", icon: Users },
] as const;

/**
 * バーの実高 (px)。画面下端との間隔と合わせて (app)/layout.tsx の main の
 * bottom padding、および record-deck / loading の縦予算に効く。
 */
const BAR_HEIGHT_REM = 4;
const BAR_HEIGHT_PX = BAR_HEIGHT_REM * 16;

/** 選択インジケータ (液体の塊) の高さ。 */
const PILL_H = 48;

/** インジケータの移動時間。goo のバネはこれを追いかけて尾を引く。 */
const MOVE_TRANSITION = "transform .52s cubic-bezier(.34,1.36,.42,1)";

/**
 * goo の塗り。必ず不透明色にすること。
 * goo フィルタは alpha' = contrast*a - offset (既定 20a - 7.83) でアルファを
 * 切り直すため、半透明色を渡すと alpha' が負に振り切れてシルエットが丸ごと
 * 消える。透け感は色そのもので作る。#3a3a3a はすりガラスのバーの上で
 * 「白 14% を乗せた」くらいに見える値。
 */
const GOO_FILL = "#3a3a3a";

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);

  // タブ外のページ (/friends, /settings, /artists/... 等) では -1。
  // その間はインジケータごと外す。
  const activeIndex = ITEMS.findIndex((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );

  return (
    <motion.nav
      // 画面幅いっぱいの帯ではなく、左右と下端から浮かせたカプセルにする
      // (iOS 26 のタブバー)。背後のコンテンツがバーの周りに見えることで
      // 初めてガラスがガラスとして読めるので、この余白は装飾ではなく必須。
      className="pointer-events-none fixed inset-x-0 bottom-0 z-10 px-4"
      initial={false}
      animate={{ y: songSheetOpen ? "150%" : 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      aria-hidden={songSheetOpen}
      // ホームインジケータの上に載せる。safe-area が無い端末でも最低 0.75rem
      // は浮かせて、画面下端に貼り付いて見えないようにする。
      style={{
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
      }}
    >
      <div
        className="pointer-events-auto relative mx-auto max-w-md rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]"
        style={{ height: `${BAR_HEIGHT_REM}rem` }}
      >
        {/* カプセル全面のすりガラス (@samasante の material モード)。
            背後をぼかす土台で、この上に液体レイヤーとタブが乗る。 */}
        <GlassSurface variant="bar" radius={9999} />

        {/* 液体グループ。シルエットは SVG で children の背面に描かれ、
            アイコンは一切フィルタされないのでクリスプなまま残る。 */}
        <Liquid
          blur={8}
          contrast={20}
          fill={GOO_FILL}
          filterPadding={40}
          style={{ position: "relative", height: "100%" }}
        >
          {activeIndex >= 0 ? (
            // move ノブはスリム側が springiness / wobble / stretch / trail。
            // stiffness / damping / tail は raw (advanced) 側の名前なので、
            // ここに直接書くと型が弾く (書けても黙って無視される)。
            <Liquid.Item
              effect="move"
              move={{ springiness: 0.5, wobble: 0.6, stretch: 0.5, trail: 0.7 }}
            >
              {/* 中身は透明。見えているのは液体シルエットだけ。
                  自分は CSS transition で動き、液体がバネで遅れて追う。 */}
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: (BAR_HEIGHT_PX - PILL_H) / 2,
                  left: 0,
                  width: `${100 / ITEMS.length}%`,
                  height: PILL_H,
                  borderRadius: PILL_H / 2,
                  transform: `translateX(${activeIndex * 100}%)`,
                  transition: MOVE_TRANSITION,
                }}
              />
            </Liquid.Item>
          ) : null}

          {/* grid grid-cols-4 で 4 タブを必ず等分。
              各タブの中心がバー幅の 1/8, 3/8, 5/8, 7/8 に常に固定される
              (= インジケータの translateX の刻みと一致する)。
              ※ プロフィール (旧「音域」タブ) は /library に集約。
                フレンド管理は /library のプロフィール内リンクから /friends へ。 */}
          <ul className="grid h-full grid-cols-4 items-center">
            {ITEMS.map((item, i) => {
              const Icon = item.icon;
              // 検索トップでは検索モードを開き、検索モードでは検索トップへ戻す。
              const onClick = (e: React.MouseEvent) => {
                triggerHaptic();
                if (item.href === "/songs" && pathname === "/songs") {
                  e.preventDefault();
                  window.dispatchEvent(new CustomEvent("app:toggle-search"));
                }
              };
              return (
                <li key={item.href} className="min-w-0">
                  <Link
                    href={item.href}
                    onClick={onClick}
                    aria-label={item.label}
                    aria-current={i === activeIndex ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center justify-center px-1 py-3",
                      i === activeIndex ? "text-white" : "text-zinc-400",
                    )}
                  >
                    <Icon className="size-6" aria-hidden />
                    <span className="sr-only">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Liquid>
      </div>
    </motion.nav>
  );
}

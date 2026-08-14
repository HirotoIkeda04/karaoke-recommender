"use client";

import { motion } from "framer-motion";
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
 * bottom padding、および record-deck / loading の縦予算に効くので、
 * 変えるときは NAV_TOTAL_REM も追う。
 */
const BAR_HEIGHT_REM = 4;

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);

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
      {/* grid grid-cols-4 で 4 タブを必ず等分。
          各タブの中心がバー幅の 1/8, 3/8, 5/8, 7/8 に常に固定される。
          ※ プロフィール (旧「音域」タブ) は /library に集約。
            フレンド管理は /library のプロフィール内リンクから /friends へ遷移。 */}
      <div
        className="pointer-events-auto relative mx-auto max-w-md rounded-full shadow-[0_10px_30px_-8px_rgba(0,0,0,0.7)]"
        style={{ height: `${BAR_HEIGHT_REM}rem` }}
      >
        {/* カプセル全面のガラス。ul にも relative を付けて両方を「配置済み要素」に
            揃えてあるので、あとは DOM 順で前後が決まる (先に置いたガラスが背面)。 */}
        <GlassSurface variant="bar" radius={9999} />

        <ul className="relative grid h-full grid-cols-4 items-center px-1.5">
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            // 検索トップでは検索モードを開き、検索モードでは検索トップへ戻す。
            const onClick = (e: React.MouseEvent) => {
              triggerHaptic();
              if (item.href === "/songs" && pathname === "/songs") {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("app:toggle-search"));
              }
            };
            return (
              <li key={item.href} className="relative min-w-0">
                {/* 選択中タブのハイライト。layoutId でタブ間をスライドさせる
                    (iOS 26 のタブバーと同じ、選択が液体的に移動する挙動)。 */}
                {active ? (
                  <motion.span
                    layoutId="app-bottom-nav-active"
                    aria-hidden
                    // mx-auto で中央寄せ (transform を使わないのは、layoutId の
                    // レイアウトアニメーションが transform を上書きするため)。
                    className="absolute inset-x-0 inset-y-2 mx-auto w-14 rounded-full bg-white/14"
                    transition={{
                      type: "spring",
                      stiffness: 420,
                      damping: 34,
                    }}
                  />
                ) : null}
                <Link
                  href={item.href}
                  onClick={onClick}
                  aria-label={item.label}
                  className={cn(
                    "relative flex w-full items-center justify-center px-1 py-3",
                    active ? "text-white" : "text-zinc-400",
                  )}
                >
                  <Icon className="size-6" aria-hidden />
                  <span className="sr-only">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.nav>
  );
}

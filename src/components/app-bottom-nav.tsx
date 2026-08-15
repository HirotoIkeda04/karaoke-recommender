"use client";

import {
  Glass,
  type GlassOptics,
  animateGlassValue,
  cubicBezier,
  deriveGlass,
  glassValue,
  useLensWobble,
} from "@samasante/liquid-glass";
import { motion } from "framer-motion";
import { Home, LibraryBig, Search, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

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

/** 選択レンズの実寸 (px)。 */
const LENS_W = 66;
const LENS_H = 50;
const LENS_R = 25;

const EASE = cubicBezier(0.34, 1.36, 0.42, 1);
const MOVE = { ease: EASE, duration: 0.52 };

/**
 * 選択レンズの光学。
 *
 * 重要: この <Glass> は wrap モード (refract を渡さず size + center を渡すと
 * children 自体が屈折対象になる) で使っている。この経路は backdrop-filter で
 * はなく `filter: url()` を children に当てるため、backdrop-filter: url() が
 * 未実装の iOS Safari でも本物の屈折が出る (iOS 26.5 実機相当で確認済み)。
 *
 * その代わり strength / dispersion は「フィルタを掛ける要素の箱」= バー全幅
 * (約 343px) に対する割合になる。公式サンプル GlassSwitch のような小さな
 * 要素向けの値 (strength 0.19) を持ち込むと 58px も変位してアイコンが崩壊
 * するので、24px のアイコン基準 (変位 4〜6px) で 0.016 前後に置いている。
 */
const LENS: Partial<GlassOptics> = {
  mapSize: 256,
  depth: 0.5,
  dispersion: 0.22,
  strength: 0.016,
  clipToShape: true,
  softEdge: true,
  curvature: 0.35,
  splay: 0.4,
  bend: 0.3,
  bendWidth: 0.14,
  frost: 0,
  brightness: 0.09,
  specular: 1.1,
  sheenAngle: 45,
  glow: 0.16,
  glowSpread: 0.5,
  glowFalloff: 1.5,
  sheen: 0.5,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  edgeShadow: "0 2px 10px rgba(0,0,0,0.4)",
};

function NavItems({ activeIndex }: { activeIndex: number }) {
  const pathname = usePathname();

  // grid grid-cols-4 で 4 タブを必ず等分。
  // 各タブの中心がバー幅の 1/8, 3/8, 5/8, 7/8 に常に固定される
  // (= レンズの center.x に渡す分数と一致する)。
  // ※ プロフィール (旧「音域」タブ) は /library に集約。
  //   フレンド管理は /library のプロフィール内リンクから /friends へ遷移。
  return (
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
  );
}

/** 選択レンズを載せたタブ列。activeIndex >= 0 のときだけ使う。 */
function LensedNavItems({ activeIndex }: { activeIndex: number }) {
  const mv = useMemo(() => {
    const pos = glassValue((activeIndex + 0.5) / ITEMS.length);
    const stretch = glassValue(0);
    // 速度に応じて進行方向へ伸び、直交方向へ潰れる (液体らしさの主成分)
    const w = deriveGlass([stretch], () => LENS_W * (1 + 0.28 * stretch.get()));
    const h = deriveGlass([stretch], () => LENS_H * (1 - 0.18 * stretch.get()));
    return { pos, stretch, w, h };
    // 初期値専用。以降の追従は下の useEffect が行う。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const holdRef = useRef(0);
  const kickRef = useRef<() => void>(() => {});
  useLensWobble(mv.pos, mv.stretch, holdRef, kickRef);

  useEffect(() => {
    animateGlassValue(mv.pos, (activeIndex + 0.5) / ITEMS.length, MOVE);
    kickRef.current();
  }, [activeIndex, mv.pos]);

  return (
    <Glass
      optics={LENS}
      center={{ x: mv.pos, y: 0.5 }}
      size={[mv.w, mv.h]}
      radius={LENS_R}
      behind="transparent"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: "100%",
        borderRadius: 9999,
      }}
    >
      <NavItems activeIndex={activeIndex} />
    </Glass>
  );
}

export function AppBottomNav() {
  const pathname = usePathname();
  const songSheetSegment = useSelectedLayoutSegment("songSheet");
  const songSheetOpen = isSongSheetOpen(pathname, songSheetSegment);

  // タブ外のページ (/friends, /settings, /artists/... 等) では -1。
  // その間はレンズごと外し、素のタブ列に戻す。
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
        {/* カプセル全面のすりガラス (material モード = 背後をぼかす)。
            タブ列は後から流れる配置済み要素なので、DOM 順でこの上に乗る。 */}
        <GlassSurface variant="bar" radius={9999} />

        {activeIndex >= 0 ? (
          <LensedNavItems activeIndex={activeIndex} />
        ) : (
          <div className="relative h-full">
            <NavItems activeIndex={-1} />
          </div>
        )}
      </div>
    </motion.nav>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Liquid } from "liquid-gooey";
import { Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import type { TabItem } from "@/components/app-bottom-nav";
import {
  BAR_FILL,
  BAR_HEIGHT_PX,
  BAR_SHADOW,
  SPLIT_GAP_PX,
} from "@/components/bottom-bar-metrics";
import { useSearchBar } from "@/components/search-bar-context";
import { GlassSurface } from "@/components/ui/glass-surface";
import { triggerHaptic } from "@/lib/haptics";

/**
 * 検索欄のある画面の下部バー。状態によってくっつく相手が入れ替わる。
 *
 *   閲覧中   [ ○ 直前のタブ ] [ 🔍 検索欄 ................. ]
 *   検索中   [ 🔍 検索欄 ................. ] [ ○ × ]
 *
 * 先頭の丸は畳まれたタブバーで、来た道 (直前に開いていたタブ) へ戻る。
 * 検索中は行き先を選ぶ場面ではないので引っ込め、代わりに検索を降りるための
 * × が末尾へ出る。どちらの丸も検索欄とは離しておく — くっついていると
 * 検索欄の一部 (クリアボタン等) に見えてしまい、役割が読めなくなる。
 *
 * ── 液体でのくっつき / 分離 ──────────────────────────────
 * 丸は「消えて現れる」のではなく、検索欄の中から染み出して離れ、戻るときは
 * 検索欄に吸い込まれる。これを goo (liquid-gooey) でやる。
 *
 * 仕掛けは 2 つ:
 *   1. 丸は検索欄と完全に重なった位置から出発し、定位置まで横へ滑る。
 *      重なっている間は 1 つの塊に見え、離れる過程で首 (ブリッジ) が伸びて
 *      切れる。透明度で出し入れすると goo は形しか見ないので、宙に浮いた
 *      塊がふっと消えるだけになる。必ず位置で出し入れすること。
 *   2. goo の塗りをバーの見えている色に合わせる。goo のシルエットはガラスの
 *      背面に描かれるので、色がずれるとガラス越しに下地が透けて見える。
 *      合わせておけば、ガラスに覆われている間は見えず、隙間に伸びた
 *      ブリッジだけが見える。
 *
 * blur はブリッジが架かる距離。定位置の間隔 (SPLIT_GAP_PX) では架からず、
 * 重なりかけたときだけ架かる値にする — 常時くっついて見えたら「離れている」
 * という構造そのものが伝わらない。
 */

/** 丸ボタンが占める幅。円の直径 + 検索欄との間隔。 */
const CIRCLE_SLOT_PX = BAR_HEIGHT_PX + SPLIT_GAP_PX;

/** 丸の出入りと検索欄の伸縮。同じ曲線で動かさないと液体が破綻して見える。 */
const SLOT_TRANSITION = { duration: 0.34, ease: [0.32, 0.72, 0, 1] } as const;

interface AppSearchBarProps {
  /** 先頭の丸が指す戻り先 (検索欄に入る直前に開いていたタブ)。 */
  backTab: TabItem;
  placeholder: string;
}

export function AppSearchBar({ backTab, placeholder }: AppSearchBarProps) {
  const { query, setQuery, open, setOpen, reset } = useSearchBar();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const BackIcon = backTab.icon;

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  // 未入力の検索欄にフォーカスしたまま下へスクロールし始めたら、
  // ソフトウェアキーボードを閉じる。横スクロール (履歴のアーティスト
  // 一覧など) は対象外にする。
  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStartRef.current = touch
        ? { x: touch.clientX, y: touch.clientY }
        : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.touches[0];
      if (
        !start ||
        !touch ||
        queryRef.current.length > 0 ||
        document.activeElement !== inputRef.current
      ) {
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = start.y - touch.clientY;
      if (deltaY > 10 && deltaY > Math.abs(deltaX)) {
        inputRef.current?.blur();
        touchStartRef.current = null;
      }
    };

    const clearTouchStart = () => {
      touchStartRef.current = null;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", clearTouchStart, { passive: true });
    window.addEventListener("touchcancel", clearTouchStart, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", clearTouchStart);
      window.removeEventListener("touchcancel", clearTouchStart);
    };
  }, []);

  return (
    <Liquid
      // blur = ブリッジが架かる距離の目安。SPLIT_GAP_PX (8px) では架からず、
      // 重なりかけたときだけ架かるところまで下げてある。
      blur={5}
      contrast={20}
      fill={BAR_FILL}
      filterPadding={48}
      style={{ position: "relative", height: "100%", flex: 1 }}
    >
      {/* ── 先頭: 直前のタブへ戻る丸 (閲覧中のみ) ──────────── */}
      <AnimatePresence initial={false}>
        {open ? null : (
          <motion.div
            key="back"
            className="absolute left-0 top-0 h-full"
            style={{ width: BAR_HEIGHT_PX }}
            // 検索欄と重なった位置から出てきて、定位置まで滑る。
            initial={{ x: CIRCLE_SLOT_PX }}
            animate={{ x: 0 }}
            exit={{ x: CIRCLE_SLOT_PX }}
            transition={SLOT_TRANSITION}
          >
            <Liquid.Item observe radius={BAR_HEIGHT_PX / 2}>
              <Link
                href={backTab.href}
                onClick={() => triggerHaptic()}
                aria-label={`${backTab.label}に戻る`}
                className="relative flex items-center justify-center rounded-full text-zinc-300"
                style={{
                  width: BAR_HEIGHT_PX,
                  height: BAR_HEIGHT_PX,
                  boxShadow: BAR_SHADOW,
                }}
              >
                <GlassSurface variant="bar" radius={9999} />
                <BackIcon className="relative size-6" aria-hidden />
              </Link>
            </Liquid.Item>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 検索欄本体 ──────────────────────────────────────
          両端を丸の有無に合わせて詰め伸ばしする。丸の滑りと同じ曲線。 */}
      <motion.div
        className="absolute top-0 h-full"
        initial={false}
        animate={{
          left: open ? 0 : CIRCLE_SLOT_PX,
          right: open ? CIRCLE_SLOT_PX : 0,
        }}
        transition={SLOT_TRANSITION}
      >
        <Liquid.Item observe radius={BAR_HEIGHT_PX / 2}>
          <div
            className="relative h-full rounded-full"
            style={{ boxShadow: BAR_SHADOW }}
          >
            <GlassSurface variant="bar" radius={9999} />
            <div className="relative flex h-full items-center gap-2 pl-5 pr-3">
              <Search className="size-5 shrink-0 text-zinc-400" aria-hidden />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                // フォーカスした時点で検索モードへ入る。降りるのは × のみ。
                onFocus={() => setOpen(true)}
                placeholder={placeholder}
                aria-label={placeholder}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="search"
                // text-base (16px) を下回ると iOS がフォーカス時に画面を
                // 拡大してしまう。ここは見た目より先にこの制約で決まる。
                // search 型ネイティブの clear ボタンは UI が分散するので非表示。
                className="min-w-0 flex-1 bg-transparent text-base text-white placeholder:text-zinc-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query.length > 0 ? (
                // 文字だけ消してフォーカスは維持する。検索モードごと降りる
                // 末尾の × とは役割が別なので、こちらは検索欄の内側に置く。
                <button
                  type="button"
                  // mousedown で input から blur する前にクリックを処理
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                  aria-label="検索文字列をクリア"
                  className="grid size-7 shrink-0 place-items-center rounded-full bg-white/10 text-zinc-300"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
          </div>
        </Liquid.Item>
      </motion.div>

      {/* ── 末尾: 検索を降りる × (検索中のみ) ───────────────── */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="close"
            className="absolute right-0 top-0 h-full"
            style={{ width: BAR_HEIGHT_PX }}
            initial={{ x: -CIRCLE_SLOT_PX }}
            animate={{ x: 0 }}
            exit={{ x: -CIRCLE_SLOT_PX }}
            transition={SLOT_TRANSITION}
          >
            <Liquid.Item observe radius={BAR_HEIGHT_PX / 2}>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic();
                  reset();
                  inputRef.current?.blur();
                }}
                aria-label="検索を閉じる"
                className="relative flex items-center justify-center rounded-full text-zinc-100"
                style={{
                  width: BAR_HEIGHT_PX,
                  height: BAR_HEIGHT_PX,
                  boxShadow: BAR_SHADOW,
                }}
              >
                <GlassSurface variant="bar" radius={9999} />
                <X className="relative size-6" aria-hidden />
              </button>
            </Liquid.Item>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Liquid>
  );
}

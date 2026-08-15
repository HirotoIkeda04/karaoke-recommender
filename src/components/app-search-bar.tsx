"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PanelBottom, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";

import {
  BAR_HEIGHT_PX,
  BAR_SHADOW,
  SPLIT_GAP_PX,
} from "@/components/bottom-bar-metrics";
import { useSearchBar } from "@/components/search-bar-context";
import { GlassSurface } from "@/components/ui/glass-surface";
import { triggerHaptic } from "@/lib/haptics";

/**
 * 検索タブの下部バー。App Store と同じく、状態によってくっつく相手が変わる。
 *
 *   閲覧中   [ ○ タブ ] [ 🔍 検索欄 ..................... ]
 *   検索中   [ 🔍 検索欄 ..................... ] [ ○ × ]
 *
 * 先頭の丸は「畳まれたタブバー」で、押すとタブが戻る。検索中は行き先を
 * 選ぶ場面ではないので引っ込め、代わりに検索を降りるための × が末尾へ出る。
 * どちらの丸も検索欄とは離しておく — くっついていると検索欄の一部
 * (クリアボタン等) に見えてしまい、役割が読めなくなる。
 */

/**
 * 丸ボタンが占める幅。円の直径 + 検索欄との間隔。
 * 間隔をここに含めているのは、親の flex に gap を持たせると
 * 幅 0 まで畳んだときに gap だけ残って隙間が開くため。
 */
const CIRCLE_SLOT_PX = BAR_HEIGHT_PX + SPLIT_GAP_PX;

/** 丸ボタンの出入り。検索欄は flex-1 なので、これに合わせて勝手に伸び縮みする。 */
const SLOT_TRANSITION = { duration: 0.32, ease: [0.32, 0.72, 0, 1] } as const;

interface AppSearchBarProps {
  /** 先頭の丸ボタン: 畳まれたタブバーを開き直す。 */
  onExpandTabs: () => void;
}

export function AppSearchBar({ onExpandTabs }: AppSearchBarProps) {
  const { query, setQuery, open, setOpen, reset } = useSearchBar();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

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
    <>
      {/* ── 先頭: 畳まれたタブバー (閲覧中のみ) ─────────────── */}
      <AnimatePresence initial={false}>
        {open ? null : (
          <motion.div
            key="tabs"
            className="h-full shrink-0 overflow-hidden"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: CIRCLE_SLOT_PX, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SLOT_TRANSITION}
          >
            <button
              type="button"
              onClick={() => {
                triggerHaptic();
                onExpandTabs();
              }}
              aria-label="タブバーを表示"
              className="relative flex items-center justify-center rounded-full text-zinc-300"
              style={{
                width: BAR_HEIGHT_PX,
                height: BAR_HEIGHT_PX,
                boxShadow: BAR_SHADOW,
              }}
            >
              <GlassSurface variant="bar" radius={9999} />
              <PanelBottom className="relative size-6" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── 検索欄本体 ─────────────────────────────────────── */}
      <div
        className="relative h-full min-w-0 flex-1 rounded-full"
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
            placeholder="楽曲・アーティストを検索"
            aria-label="楽曲・アーティストを検索"
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

      {/* ── 末尾: 検索を降りる × (検索中のみ) ───────────────── */}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="close"
            className="flex h-full shrink-0 justify-end overflow-hidden"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: CIRCLE_SLOT_PX, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={SLOT_TRANSITION}
          >
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
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

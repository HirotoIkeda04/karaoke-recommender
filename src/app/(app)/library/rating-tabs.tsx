"use client";

import { Check, Dumbbell, Minus, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import type { Database } from "@/types/database";

import { SortableList, type EvaluationRow } from "./sortable-list";

type Rating = Database["public"]["Enums"]["rating_type"];

const TABS: ReadonlyArray<{ value: Rating; label: string; Icon: typeof X }> = [
  { value: "easy", label: "得意", Icon: Check },
  { value: "practicing", label: "練習中", Icon: Dumbbell },
  { value: "medium", label: "普通", Icon: Minus },
  { value: "hard", label: "苦手", Icon: X },
];

// このピクセルだけ横に動けばスワイプ確定 (それ未満なら元のパネルにスナップバック)
const SWIPE_THRESHOLD_PX = 40;
// 横ドラッグと判断する最小移動量 (縦スクロール優先のため少し緩め)
const HORIZONTAL_INTENT_PX = 8;

interface Props {
  evaluationsByRating: Record<Rating, EvaluationRow[]>;
  knownSongIds: string[];
  initialTab: Rating;
}

export function RatingTabs({
  evaluationsByRating,
  knownSongIds,
  initialTab,
}: Props) {
  const [activeTab, setActiveTab] = useState<Rating>(initialTab);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentIdx = useRef<number>(
    Math.max(0, TABS.findIndex((t) => t.value === initialTab)),
  );
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const isVerticalScroll = useRef(false);

  // 初期位置 + リサイズ追従 (orientation change 対策)
  useLayoutEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const sync = () => {
      c.scrollLeft = currentIdx.current * c.clientWidth;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const goToIndex = (idx: number, smooth = true) => {
    const c = scrollRef.current;
    if (!c) return;
    const clamped = Math.max(0, Math.min(TABS.length - 1, idx));
    currentIdx.current = clamped;
    c.scrollTo({
      left: clamped * c.clientWidth,
      behavior: smooth ? "smooth" : "auto",
    });
    const newTab = TABS[clamped].value;
    setActiveTab(newTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", newTab);
    window.history.replaceState(null, "", url.toString());
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
    isDragging.current = false;
    isVerticalScroll.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start || isVerticalScroll.current) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!isDragging.current) {
      if (
        Math.abs(dx) > HORIZONTAL_INTENT_PX &&
        Math.abs(dx) > Math.abs(dy)
      ) {
        isDragging.current = true;
      } else if (Math.abs(dy) > HORIZONTAL_INTENT_PX) {
        isVerticalScroll.current = true;
        return;
      } else {
        return;
      }
    }
    const c = scrollRef.current;
    if (!c) return;
    c.scrollLeft = currentIdx.current * c.clientWidth - dx;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    const wasDragging = isDragging.current;
    touchStart.current = null;
    isDragging.current = false;
    if (!start || !wasDragging) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) {
      goToIndex(currentIdx.current);
      return;
    }
    goToIndex(dx < 0 ? currentIdx.current + 1 : currentIdx.current - 1);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {TABS.map((tab) => {
          const active = tab.value === activeTab;
          const count = evaluationsByRating[tab.value]?.length ?? 0;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() =>
                goToIndex(TABS.findIndex((t) => t.value === tab.value))
              }
              className={`flex flex-col items-center gap-0.5 rounded-md px-2 py-2 text-xs ${
                active
                  ? "bg-white shadow-sm dark:bg-zinc-900"
                  : "text-zinc-600 dark:text-zinc-400"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                <tab.Icon className="size-3.5" aria-hidden />
                {tab.label}
              </span>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={scrollRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        className="overflow-hidden"
        style={{ touchAction: "pan-y" }}
      >
        <div className="flex">
          {TABS.map((tab) => {
            const rows = evaluationsByRating[tab.value] ?? [];
            return (
              <div key={tab.value} className="w-full shrink-0">
                {rows.length === 0 ? (
                  <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                    このカテゴリの曲はまだありません
                  </div>
                ) : (
                  <SortableList
                    evaluations={rows}
                    knownSongIds={knownSongIds}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

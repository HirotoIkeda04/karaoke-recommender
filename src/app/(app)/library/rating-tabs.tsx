"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Dumbbell,
  Minus,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Database } from "@/types/database";

import {
  SORT_OPTIONS,
  SortableList,
  type EvaluationRow,
  type SortDir,
  type SortKey,
} from "./sortable-list";

type Rating = Database["public"]["Enums"]["rating_type"];
// library に表示するのは positive/negative の 4 段階のみ。skip は除外。
type DisplayRating = Exclude<Rating, "skip">;

const TABS: ReadonlyArray<{ value: DisplayRating; label: string; Icon: typeof X }> = [
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
  evaluationsByRating: Record<DisplayRating, EvaluationRow[]>;
  knownSongIds: string[];
  initialTab: DisplayRating;
  /** false にすると曲行を曲詳細にリンクしない (フレンド閲覧モード) */
  linkable?: boolean;
}

export function RatingTabs({
  evaluationsByRating,
  knownSongIds,
  initialTab,
  linkable = true,
}: Props) {
  const [activeTab, setActiveTab] = useState<DisplayRating>(initialTab);
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [sortOpen, setSortOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentIdx = useRef<number>(
    Math.max(0, TABS.findIndex((t) => t.value === initialTab)),
  );
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const isVerticalScroll = useRef(false);

  // ソートドロップダウンの click-outside 閉じる
  useEffect(() => {
    if (!sortOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        sortMenuRef.current &&
        !sortMenuRef.current.contains(e.target as Node)
      ) {
        setSortOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [sortOpen]);

  const currentSort = SORT_OPTIONS.find((o) => o.key === sortKey)!;
  const activeCount = evaluationsByRating[activeTab]?.length ?? 0;

  const handleSelectSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SORT_OPTIONS.find((o) => o.key === key)!.defaultDir);
    }
    setSortOpen(false);
  };

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
      <div className="grid grid-cols-4 border-b border-zinc-200 dark:border-zinc-800">
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
              className={`-mb-px flex flex-col items-center gap-0.5 border-b py-3 transition-colors ${
                active
                  ? "border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                  : "border-transparent text-zinc-400 dark:text-zinc-500"
              }`}
            >
              <tab.Icon className="size-4" strokeWidth={2} aria-hidden />
              <span className="text-[11px] tabular-nums">
                {tab.label}({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* ソートヘッダ: ソート (左) + 件数 (右)。横スワイプの外に置いて固定表示 */}
      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-500">
        <div ref={sortMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setSortOpen(!sortOpen)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-haspopup="menu"
            aria-expanded={sortOpen}
          >
            <ArrowUpDown className="size-3.5" aria-hidden />
            <span>{currentSort.label}</span>
            {sortDir === "asc" ? (
              <ArrowUp className="size-3" aria-hidden />
            ) : (
              <ArrowDown className="size-3" aria-hidden />
            )}
          </button>

          {sortOpen ? (
            <div
              className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
              role="menu"
            >
              <ul className="py-1">
                {SORT_OPTIONS.map((option) => {
                  const selected = option.key === sortKey;
                  return (
                    <li key={option.key}>
                      <button
                        type="button"
                        onClick={() => handleSelectSort(option.key)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs text-zinc-700 transition hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                        role="menuitem"
                      >
                        <span className="flex items-center gap-2">
                          <Check
                            className={`size-3 ${
                              selected
                                ? "text-primary"
                                : "invisible"
                            }`}
                            aria-hidden
                          />
                          {option.label}
                        </span>
                        {selected ? (
                          sortDir === "asc" ? (
                            <ArrowUp
                              className="size-3 text-primary"
                              aria-hidden
                            />
                          ) : (
                            <ArrowDown
                              className="size-3 text-primary"
                              aria-hidden
                            />
                          )
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
        <span>{activeCount} 曲</span>
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
                    sortKey={sortKey}
                    sortDir={sortDir}
                    knownSongIds={knownSongIds}
                    linkable={linkable}
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

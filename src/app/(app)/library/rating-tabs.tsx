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

  // 初期スクロール位置 (URL の ?tab= を反映、フラッシュ防止のため layout effect)
  useLayoutEffect(() => {
    const idx = TABS.findIndex((t) => t.value === initialTab);
    const c = scrollRef.current;
    if (!c || idx <= 0) return;
    c.scrollLeft = idx * c.clientWidth;
  }, [initialTab]);

  const handleTabClick = (tab: Rating) => {
    const idx = TABS.findIndex((t) => t.value === tab);
    const c = scrollRef.current;
    if (!c) return;
    setActiveTab(tab);
    c.scrollTo({ left: idx * c.clientWidth, behavior: "smooth" });
  };

  // 水平スクロール → どのパネルが中央に来ているか判定 → 状態更新 + URL replace
  const handleScroll = () => {
    const c = scrollRef.current;
    if (!c) return;
    const idx = Math.round(c.scrollLeft / c.clientWidth);
    const newTab = TABS[idx]?.value;
    if (!newTab || newTab === activeTab) return;
    setActiveTab(newTab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", newTab);
    window.history.replaceState(null, "", url.toString());
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
              onClick={() => handleTabClick(tab.value)}
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
        onScroll={handleScroll}
        className="snap-x snap-mandatory overflow-x-auto overscroll-x-contain [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
      >
        <div className="flex">
          {TABS.map((tab) => {
            const rows = evaluationsByRating[tab.value] ?? [];
            return (
              <div
                key={tab.value}
                className="w-full shrink-0 snap-start"
              >
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

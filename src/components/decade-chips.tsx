"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

export const DECADES = [
  { label: "2020年代", start: 2020, end: 2029 },
  { label: "2010年代", start: 2010, end: 2019 },
  { label: "2000年代", start: 2000, end: 2009 },
  { label: "1990年代", start: 1990, end: 1999 },
  { label: "1980年代", start: 1980, end: 1989 },
] as const;

const CHIP_TRANSITION = { type: "spring", stiffness: 500, damping: 35 } as const;

interface DecadeChipsProps {
  selected: number[];
  onToggle: (start: number) => void;
}

/** 選択中の年代を先頭へ寄せ、隣り合う選択チップを連結表示する。 */
export function DecadeChips({ selected, onToggle }: DecadeChipsProps) {
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const ordered = useMemo(() => {
    const selectedChips = selected
      .map((start) => DECADES.find((decade) => decade.start === start))
      .filter((decade): decade is (typeof DECADES)[number] => Boolean(decade));
    const unselectedChips = DECADES.filter(
      (decade) => !selectedSet.has(decade.start),
    );
    return [...selectedChips, ...unselectedChips];
  }, [selected, selectedSet]);

  return (
    <motion.div
      layout
      className="-mx-4 flex overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="年代で絞り込む"
    >
      {ordered.map((decade, index) => {
        const active = selectedSet.has(decade.start);
        const previous = index > 0 ? ordered[index - 1] : null;
        const next = index < ordered.length - 1 ? ordered[index + 1] : null;
        const previousIsActive =
          previous != null && selectedSet.has(previous.start) && active;
        const nextIsActive =
          next != null && selectedSet.has(next.start) && active;
        const radius =
          previousIsActive && nextIsActive
            ? "rounded-none"
            : previousIsActive
              ? "rounded-l-none rounded-r-full"
              : nextIsActive
                ? "rounded-l-full rounded-r-none"
                : "rounded-full";
        const divider = previousIsActive
          ? "border-l border-zinc-300/60 dark:border-zinc-700"
          : "";
        const marginRight =
          next == null || (active && selectedSet.has(next.start)) ? "" : "mr-2";
        const tone = active
          ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-50 dark:text-zinc-950"
          : "border border-zinc-300 bg-transparent font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800";

        return (
          <motion.button
            key={decade.start}
            layout
            transition={CHIP_TRANSITION}
            type="button"
            onClick={() => onToggle(decade.start)}
            aria-pressed={active}
            className={`shrink-0 px-3 py-1 text-xs active:scale-95 ${tone} ${radius} ${divider} ${marginRight}`}
          >
            {decade.label}
          </motion.button>
        );
      })}
    </motion.div>
  );
}

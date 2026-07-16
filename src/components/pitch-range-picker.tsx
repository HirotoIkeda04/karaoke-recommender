"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { KARAOKE_NOTE_OPTIONS, karaokeToMidi } from "@/lib/note";

const WHEEL_ITEM_HEIGHT = 44;
const DEFAULT_WHEEL_NOTATION = "hiA";
const SHEET_TRANSITION = {
  duration: 0.24,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

const WHEEL_OPTIONS = [
  ...[...KARAOKE_NOTE_OPTIONS].reverse().map((note) => ({
    ...note,
    label: note.notation,
  })),
] as const;

interface PitchRangePickerProps {
  min: string;
  max: string;
  onChange: (min: string, max: string) => void;
}

function rangeLabel(min: string, max: string) {
  if (!min && !max) return "範囲を指定";
  return `${min || "下限なし"} 〜 ${max || "上限なし"}`;
}

function PitchWheel({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const wheelId = useId();
  const wheelRef = useRef<HTMLDivElement>(null);
  const settleTimerRef = useRef<number | null>(null);
  const userScrollingRef = useRef(false);
  const wheelValue = value || DEFAULT_WHEEL_NOTATION;
  const selectedIndex = Math.max(
    0,
    WHEEL_OPTIONS.findIndex((option) => option.notation === wheelValue),
  );

  useEffect(() => {
    userScrollingRef.current = false;
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    const frame = window.requestAnimationFrame(() => {
      wheelRef.current?.scrollTo({
        top: selectedIndex * WHEEL_ITEM_HEIGHT,
        behavior: "auto",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedIndex]);

  useEffect(
    () => () => {
      if (settleTimerRef.current != null) {
        window.clearTimeout(settleTimerRef.current);
      }
    },
    [],
  );

  const scrollToIndex = (index: number) => {
    wheelRef.current?.scrollTo({
      top: index * WHEEL_ITEM_HEIGHT,
      behavior: "smooth",
    });
  };

  const selectIndex = (index: number) => {
    const next = WHEEL_OPTIONS[Math.max(0, Math.min(index, WHEEL_OPTIONS.length - 1))];
    if (!next) return;
    onChange(next.notation);
    scrollToIndex(index);
  };

  return (
    <div className="min-w-0 flex-1">
      <p className="mb-2 text-center text-xs font-semibold text-zinc-600 dark:text-zinc-300">
        {label}
      </p>
      <div className="relative h-[220px] overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900">
        {value ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-2 top-1/2 z-0 h-11 -translate-y-1/2 rounded-xl border-y border-zinc-300 bg-white/80 dark:border-zinc-600 dark:bg-zinc-700/80"
          />
        ) : null}
        <div
          ref={wheelRef}
          role="listbox"
          tabIndex={0}
          aria-label={label}
          aria-activedescendant={
            value ? `${wheelId}-${selectedIndex}` : undefined
          }
          className="relative z-10 h-full snap-y snap-mandatory overflow-y-auto overscroll-contain py-[88px] outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(event) => {
            if (!userScrollingRef.current) return;
            const element = event.currentTarget;
            if (settleTimerRef.current != null) {
              window.clearTimeout(settleTimerRef.current);
            }
            settleTimerRef.current = window.setTimeout(() => {
              const index = Math.max(
                0,
                Math.min(
                  Math.round(element.scrollTop / WHEEL_ITEM_HEIGHT),
                  WHEEL_OPTIONS.length - 1,
                ),
              );
              const next = WHEEL_OPTIONS[index];
              if (next && next.notation !== value) onChange(next.notation);
            }, 100);
          }}
          onWheel={() => {
            userScrollingRef.current = true;
          }}
          onTouchStart={() => {
            userScrollingRef.current = true;
          }}
          onPointerDown={() => {
            userScrollingRef.current = true;
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            selectIndex(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
          }}
        >
          {WHEEL_OPTIONS.map((option, index) => {
            const selected = option.notation === value;
            return (
              <button
                key={option.notation || "unset"}
                id={`${wheelId}-${index}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-label={option.label}
                aria-selected={selected}
                className={`flex h-11 w-full snap-center snap-always items-center justify-center px-2 text-sm transition ${
                  selected
                    ? "font-bold text-zinc-950 dark:text-zinc-50"
                    : "font-medium text-zinc-400 dark:text-zinc-500"
                }`}
                onClick={() => selectIndex(index)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-zinc-100 to-transparent dark:from-zinc-900"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-zinc-100 to-transparent dark:from-zinc-900"
        />
      </div>
      <button
        type="button"
        aria-pressed={!value}
        className={`mt-2 flex h-11 w-full items-center justify-center rounded-2xl text-sm transition active:scale-[0.98] ${
          !value
            ? "bg-zinc-300 font-bold text-zinc-950 dark:bg-zinc-700 dark:text-zinc-50"
            : "bg-zinc-100 font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
        }`}
        onClick={() => onChange("")}
      >
        指定なし
      </button>
    </div>
  );
}

export function PitchRangePicker({ min, max, onChange }: PitchRangePickerProps) {
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draftMin, setDraftMin] = useState(min);
  const [draftMax, setDraftMax] = useState(max);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => sheetRef.current?.focus());

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        sheetRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [close, open]);

  const openPicker = () => {
    setDraftMin(min);
    setDraftMax(max);
    setOpen(true);
  };

  const changeDraftMin = (notation: string) => {
    setDraftMin(notation);
    const nextMin = karaokeToMidi(notation);
    const currentMax = karaokeToMidi(draftMax);
    if (nextMin != null && currentMax != null && nextMin > currentMax) {
      setDraftMax(notation);
    }
  };

  const changeDraftMax = (notation: string) => {
    setDraftMax(notation);
    const nextMax = karaokeToMidi(notation);
    const currentMin = karaokeToMidi(draftMin);
    if (nextMax != null && currentMin != null && nextMax < currentMin) {
      setDraftMin(notation);
    }
  };

  const sheet = typeof document === "undefined" ? null : createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={SHEET_TRANSITION}
        >
          <button
            type="button"
            aria-label="最高音の選択を閉じる"
            className="absolute inset-0 size-full bg-black/65 backdrop-blur-[2px]"
            onClick={close}
          />
          <motion.div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-12px_48px_rgba(0,0,0,0.35)] outline-none dark:bg-zinc-950"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SHEET_TRANSITION}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />

            <div className="flex items-center justify-between">
              <div>
                <h2 id={titleId} className="text-base font-bold text-zinc-950 dark:text-zinc-50">
                  最高音の範囲
                </h2>
              </div>
              <button
                type="button"
                aria-label="閉じる"
                className="grid size-9 place-items-center rounded-full bg-zinc-100 text-zinc-600 active:scale-95 dark:bg-zinc-800 dark:text-zinc-300"
                onClick={close}
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2">
              <PitchWheel label="下限" value={draftMin} onChange={changeDraftMin} />
              <span className="mt-6 shrink-0 text-sm font-bold text-zinc-400 dark:text-zinc-500">
                〜
              </span>
              <PitchWheel label="上限" value={draftMax} onChange={changeDraftMax} />
            </div>

            <div className="mt-5">
              <button
                type="button"
                className="w-full rounded-xl bg-zinc-950 px-4 py-3 text-sm font-bold text-white active:scale-[0.98] dark:bg-zinc-50 dark:text-zinc-950"
                onClick={() => {
                  onChange(draftMin, draftMax);
                  close();
                }}
              >
                完了
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-zinc-100 px-3 py-2.5 text-left transition active:scale-[0.99] dark:bg-zinc-800"
        onClick={openPicker}
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            最高音
          </span>
          <span className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {rangeLabel(min, max)}
          </span>
        </span>
        <ChevronDown
          className="size-4 shrink-0 text-zinc-500 dark:text-zinc-400"
          aria-hidden
        />
      </button>
      {sheet}
    </>
  );
}

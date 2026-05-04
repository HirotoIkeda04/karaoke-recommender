"use client";

import { Check, Dumbbell, Minus, X } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

import type { Database } from "@/types/database";

import { rateSong, unrateSong } from "../../actions";

type Rating = Database["public"]["Enums"]["rating_type"];

const RATINGS: ReadonlyArray<{
  value: Rating;
  label: string;
  Icon: typeof X;
  color: string;
}> = [
  { value: "hard", label: "苦手", Icon: X, color: "bg-red-500 text-white" },
  { value: "medium", label: "普通", Icon: Minus, color: "bg-yellow-500 text-white" },
  { value: "easy", label: "得意", Icon: Check, color: "bg-emerald-500 text-white" },
  { value: "practicing", label: "練習中", Icon: Dumbbell, color: "bg-purple-500 text-white" },
];

const RATING_LABELS: Record<Rating, string> = RATINGS.reduce(
  (acc, r) => ({ ...acc, [r.value]: r.label }),
  {} as Record<Rating, string>,
);

interface RatingControlsProps {
  songId: string;
  initialRating: Rating | null;
}

type Toast = { id: number; message: string };

export function RatingControls({ songId, initialRating }: RatingControlsProps) {
  const [rating, setRating] = useState<Rating | null>(initialRating);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  const persist = (nextRating: Rating | null, message: string) => {
    setError(null);
    startTransition(async () => {
      const res = nextRating
        ? await rateSong({ songId, rating: nextRating })
        : await unrateSong(songId);
      if (!res.ok) {
        setError(res.error ?? "保存に失敗しました");
      } else {
        setToast({ id: Date.now(), message });
      }
    });
  };

  const handleSelect = (next: Rating) => {
    setIsOpen(false);
    if (rating === next) return;
    setRating(next);
    persist(next, `評価を「${RATING_LABELS[next]}」に変更しました`);
  };

  const handleClear = () => {
    setIsOpen(false);
    setRating(null);
    persist(null, "評価を取り消しました");
  };

  const activeRating = RATINGS.find((r) => r.value === rating);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={isPending}
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`inline-flex h-10 items-center gap-2 rounded-full px-14 text-sm font-medium transition disabled:opacity-50 ${
          activeRating
            ? `${activeRating.color} shadow-sm`
            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
        }`}
      >
        {activeRating ? (
          <>
            <activeRating.Icon className="size-4" aria-hidden />
            {activeRating.label}
          </>
        ) : (
          "評価を追加"
        )}
      </button>

      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}

      {isOpen ? (
        <div
          className="fixed inset-0 z-50"
          role="dialog"
          aria-modal="true"
          aria-label="評価を選択"
        >
          <button
            type="button"
            aria-label="閉じる"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 animate-in fade-in bg-black/60"
          />
          <div className="absolute inset-x-0 bottom-0 animate-in slide-in-from-bottom rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl dark:bg-zinc-900">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
            <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              評価を選択
            </h3>
            <ul className="space-y-1">
              {RATINGS.map((r) => {
                const active = rating === r.value;
                return (
                  <li key={r.value}>
                    <button
                      type="button"
                      onClick={() => handleSelect(r.value)}
                      disabled={isPending}
                      aria-pressed={active}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition disabled:opacity-50 ${
                        active
                          ? "bg-zinc-100 dark:bg-zinc-800"
                          : "hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <span
                        className={`grid size-8 place-items-center rounded-full ${r.color}`}
                      >
                        <r.Icon className="size-4" aria-hidden />
                      </span>
                      <span className="flex-1 text-left">{r.label}</span>
                    </button>
                  </li>
                );
              })}
              {rating ? (
                <li className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isPending}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    <span className="grid size-8 place-items-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                      <X className="size-4" aria-hidden />
                    </span>
                    <span className="flex-1 text-left">評価を取り消す</span>
                  </button>
                </li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
        >
          <div className="animate-in fade-in slide-in-from-bottom-2 rounded-full bg-zinc-900/90 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur dark:bg-zinc-100/90 dark:text-zinc-900">
            {toast.message}
          </div>
        </div>
      ) : null}
    </div>
  );
}

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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

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

  const handleRate = (next: Rating) => {
    if (rating === next) {
      setRating(null);
      persist(null, "評価を取り消しました");
    } else {
      setRating(next);
      persist(next, `評価を「${RATING_LABELS[next]}」に変更しました`);
    }
  };

  return (
    <div className="relative space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {RATINGS.map((r) => {
          const active = rating === r.value;
          return (
            <button
              key={r.value}
              type="button"
              disabled={isPending}
              onClick={() => handleRate(r.value)}
              aria-pressed={active}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                active
                  ? r.color
                  : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              }`}
            >
              <r.Icon className="size-4" aria-hidden />
              {r.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
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

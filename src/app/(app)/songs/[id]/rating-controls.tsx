"use client";

import { Check, Dumbbell, Minus, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
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

interface RatingControlsProps {
  songId: string;
  initialRating: Rating | null;
  initialMemo: string;
}

export function RatingControls({
  songId,
  initialRating,
  initialMemo,
}: RatingControlsProps) {
  const [rating, setRating] = useState<Rating | null>(initialRating);
  const [memo, setMemo] = useState(initialMemo);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const persist = (nextRating: Rating | null, nextMemo: string) => {
    setError(null);
    startTransition(async () => {
      const res = nextRating
        ? await rateSong({ songId, rating: nextRating, memo: nextMemo })
        : await unrateSong(songId);
      if (!res.ok) {
        setError(res.error ?? "保存に失敗しました");
      } else {
        setSavedAt(Date.now());
      }
    });
  };

  const handleRate = (next: Rating) => {
    setRating(next);
    persist(next, memo);
  };

  const handleUnrate = () => {
    setRating(null);
    persist(null, "");
  };

  const handleMemoBlur = () => {
    if (rating) persist(rating, memo);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {RATINGS.map((r) => {
          const active = rating === r.value;
          return (
            <button
              key={r.value}
              type="button"
              disabled={isPending}
              onClick={() => handleRate(r.value)}
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

      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={handleMemoBlur}
        placeholder="メモ (歌い方のコツ・キー調整など)"
        rows={3}
        disabled={!rating || isPending}
        className="w-full resize-none rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-pink-500 focus:outline-none disabled:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:disabled:bg-zinc-950"
      />

      {rating ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleUnrate}
          disabled={isPending}
          className="text-zinc-500 hover:text-zinc-700"
        >
          評価を取り消す
        </Button>
      ) : null}

      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : savedAt ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          保存しました
        </p>
      ) : null}
    </div>
  );
}

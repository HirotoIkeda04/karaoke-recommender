"use client";

import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setRoomRecurring } from "./actions";

interface Props {
  roomId: string;
  isRecurring: boolean;
}

export function RecurringToggle({ roomId, isRecurring }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await setRoomRecurring(roomId, !isRecurring);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <section
      className={
        isRecurring
          ? "rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30"
          : "rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      }
    >
      <div className="flex items-start gap-3">
        <Star
          className={
            isRecurring
              ? "size-5 shrink-0 fill-amber-500 text-amber-500"
              : "size-5 shrink-0 text-zinc-400 dark:text-zinc-600"
          }
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {isRecurring ? "いつものルーム" : "いつものルームにする"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {isRecurring
              ? "90 日経過後も自動削除されません"
              : "保存しておけば 90 日後の自動削除を回避できます"}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className={
            isRecurring
              ? "shrink-0 rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
              : "shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
          }
        >
          {pending ? "..." : isRecurring ? "解除" : "★ 設定"}
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </section>
  );
}

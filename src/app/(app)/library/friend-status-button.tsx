"use client";

import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { removeFriend } from "@/app/(app)/friends/actions";

interface Props {
  friendId: string;
  friendDisplayName: string;
}

export function FriendStatusButton({ friendId, friendDisplayName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, pending]);

  const confirmRemove = () => {
    setError(null);
    startTransition(async () => {
      const result = await removeFriend(friendId);
      if (result.error) {
        setError(result.error);
        return;
      }
      const params = new URLSearchParams({ name: friendDisplayName });
      router.replace(`/friends/removed?${params.toString()}`);
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Check className="size-3.5" aria-hidden />
        あなたのフレンドです
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !pending) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="フレンド解除の確認"
        >
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                フレンドを解除しますか？
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                {friendDisplayName} さんとのフレンド関係を解除します。お互いのライブラリは見られなくなります。
              </p>
            </div>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                onClick={() => setOpen(false)}
                variant="ghost"
                size="sm"
                className="flex-1"
                disabled={pending}
              >
                キャンセル
              </Button>
              <Button
                onClick={confirmRemove}
                variant="destructive"
                size="sm"
                className="flex-1"
                disabled={pending}
              >
                {pending ? "解除中..." : "解除する"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";

export function SignOutButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="サインアウト"
        className="flex h-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 px-3 text-zinc-700 hover:bg-zinc-300 active:bg-zinc-300 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:active:bg-zinc-800"
      >
        <LogOut className="size-4" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="サインアウトの確認"
        >
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                本当にサインアウトしますか？
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                サインアウトしてもデータは削除されません。再度ログインすればこれまでの評価・フレンド情報がそのまま利用できます。
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full bg-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-300 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:active:bg-zinc-700"
              >
                キャンセル
              </button>
              <form action="/auth/signout" method="post" className="flex-1">
                <button
                  type="submit"
                  className="w-full rounded-full bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 active:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 dark:active:bg-red-600"
                >
                  サインアウト
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

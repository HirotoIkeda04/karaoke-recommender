"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { joinAsGuest } from "./actions";

interface Props {
  qrToken: string;
  creatorName: string | null;
}

export function GuestNameForm({ qrToken, creatorName }: Props) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("表示名を入力してください");
      return;
    }
    if (trimmed.length > 32) {
      setError("32文字以内で入力してください");
      return;
    }

    startTransition(async () => {
      const result = await joinAsGuest(qrToken, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      // 成功時は revalidatePath でサーバ側が再描画 → cookie あり扱いで GuestRoomView に切り替わる
    });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            カラオケアプリ
          </p>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            ルームに参加
          </h1>
          {creatorName ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {creatorName} さんのルーム
            </p>
          ) : null}
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="space-y-1.5">
            <label
              htmlFor="guest-name"
              className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
            >
              表示名
            </label>
            <input
              id="guest-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={32}
              autoFocus
              placeholder="あなたの名前"
              // text-base で iOS Safari の自動ズームを防ぐ
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
            />
            <p className="text-xs text-zinc-500 dark:text-zinc-500">
              ルーム参加者にこの名前で表示されます
            </p>
          </div>

          {error ? (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={pending}
            size="lg"
            className="w-full"
          >
            {pending ? "参加中..." : "ゲストとして参加"}
          </Button>
        </form>

        <div className="space-y-2 text-center">
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            アカウントを持っている場合
          </p>
          <Link
            href={`/login?next=${encodeURIComponent(`/r/${qrToken}`)}`}
            className="text-sm font-medium text-pink-600 hover:underline dark:text-pink-400"
          >
            ログインして参加
          </Link>
        </div>
      </div>
    </main>
  );
}

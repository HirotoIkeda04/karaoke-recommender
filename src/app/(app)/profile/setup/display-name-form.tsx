"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { updateDisplayName } from "./actions";

interface Props {
  initialName: string;
  next: string;
}

export function DisplayNameForm({ initialName, next }: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      const result = await updateDisplayName(trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(next);
      router.refresh();
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label
          htmlFor="display-name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          表示名
        </label>
        <input
          id="display-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={32}
          autoFocus
          // text-base: iOS Safari でフォントサイズ16未満だと自動ズームが入るのを防ぐ
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:border-zinc-500 dark:focus:ring-zinc-800"
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          1〜32文字。フレンド・ルーム参加者に表示されます
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
        className="w-full"
        size="lg"
      >
        {pending ? "保存中..." : "保存"}
      </Button>
    </form>
  );
}

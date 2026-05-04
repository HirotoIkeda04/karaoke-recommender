"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_ICON_COLOR,
  ICON_COLOR_PALETTE,
  resolveIconColor,
} from "@/lib/icon-color";

import { updateProfile } from "./actions";

interface Props {
  initialName: string;
  initialColor: string | null;
  next: string;
}

// 絵文字や合字に対しても安全に 1 grapheme を取り出す
function firstGrapheme(name: string): string {
  if (!name) return "?";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter("ja", { granularity: "grapheme" });
    const first = seg.segment(name)[Symbol.iterator]().next().value;
    if (first?.segment) return first.segment.toUpperCase();
  }
  return name.charAt(0).toUpperCase();
}

export function ProfileForm({ initialName, initialColor, next }: Props) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string>(
    resolveIconColor(initialColor) ?? DEFAULT_ICON_COLOR,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initial = firstGrapheme(name);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("ユーザーネームを入力してください");
      return;
    }
    if (trimmed.length > 32) {
      setError("32文字以内で入力してください");
      return;
    }

    startTransition(async () => {
      const result = await updateProfile(trimmed, color, next);
      if (result?.error) {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* ユーザーネーム */}
      <div className="space-y-1.5">
        <label
          htmlFor="display-name"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          ユーザーネーム
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

      {/* アイコンの色 */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          アイコンの色
        </h2>

        <div className="flex items-center gap-3">
          <div
            className="flex size-16 shrink-0 items-center justify-center rounded-full text-2xl font-semibold text-white"
            style={{ backgroundColor: color }}
            aria-label="アイコンプレビュー"
          >
            {initial}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-500">
            フレンドやカラオケルームで表示されるアイコンの色を選べます
          </div>
        </div>

        <div
          role="radiogroup"
          aria-label="アイコンの色"
          className="grid grid-cols-9 gap-2"
        >
          {ICON_COLOR_PALETTE.map((c) => {
            const selected = c === color;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={c}
                onClick={() => setColor(c)}
                className={
                  "size-8 rounded-full transition active:scale-95 " +
                  (selected
                    ? "ring-2 ring-offset-2 ring-zinc-900 ring-offset-white dark:ring-zinc-50 dark:ring-offset-zinc-950"
                    : "")
                }
                style={{ backgroundColor: c }}
              />
            );
          })}
        </div>
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
        className="w-full bg-white text-zinc-900 hover:bg-zinc-100 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
      >
        {pending ? "保存中..." : "保存"}
      </Button>
    </form>
  );
}

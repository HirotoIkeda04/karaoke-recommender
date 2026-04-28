"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { createInviteLink } from "./actions";

interface IssuedLink {
  url: string;
  expiresAt: string;
}

export function InviteLinkSection() {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createInviteLink();
      if (result.error || !result.path || !result.expiresAt) {
        setError(result.error ?? "リンク発行に失敗しました");
        return;
      }
      setLink({
        url: `${window.location.origin}${result.path}`,
        expiresAt: result.expiresAt,
      });
    });
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("クリップボードにコピーできませんでした");
    }
  };

  const share = async () => {
    if (!link) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          url: link.url,
          title: "カラオケアプリのフレンド申請",
        });
      } catch {
        // ユーザーキャンセル or 失敗 → コピーにフォールバック
        copy();
      }
    } else {
      copy();
    }
  };

  const canShare =
    typeof navigator !== "undefined" && "share" in navigator;

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          招待リンクを発行
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          リンクを共有した相手がタップするとフレンドになれます。複数人OK・7日有効。
        </p>
      </div>

      {!link ? (
        <Button
          onClick={generate}
          disabled={pending}
          size="lg"
          className="w-full"
        >
          {pending ? "発行中..." : "招待リンクを発行する"}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs break-all text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
            {link.url}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            有効期限: {new Date(link.expiresAt).toLocaleString("ja-JP")}
          </p>
          <div className="flex flex-wrap gap-2">
            {canShare ? (
              <Button onClick={share} size="lg" className="flex-1">
                共有
              </Button>
            ) : null}
            <Button
              onClick={copy}
              size="lg"
              variant="outline"
              className="flex-1"
            >
              {copied ? "コピー済み ✓" : "コピー"}
            </Button>
            <Button
              onClick={generate}
              size="lg"
              variant="ghost"
              disabled={pending}
            >
              再発行
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
    </section>
  );
}

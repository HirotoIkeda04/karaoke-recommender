"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { endRoom, regenerateQr } from "./actions";

interface Props {
  url: string;
  qrSvg: string; // サーバ側で生成した SVG 文字列
  expiresAt: string;
  roomId: string;
  isCreator: boolean;
  ended: boolean;
}

export function QrSection({
  url,
  qrSvg,
  expiresAt,
  roomId,
  isCreator,
  ended,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expired = new Date(expiresAt).getTime() < Date.now();
  const canShare =
    typeof navigator !== "undefined" && "share" in navigator;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("クリップボードにコピーできませんでした");
    }
  };

  const share = async () => {
    if (canShare) {
      try {
        await navigator.share({
          url,
          title: "カラオケルームに参加",
        });
      } catch {
        copy();
      }
    } else {
      copy();
    }
  };

  const regen = () => {
    setError(null);
    startTransition(async () => {
      const result = await regenerateQr(roomId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const end = () => {
    if (!confirm("ルームを終了しますか？再開はできません。")) return;
    setError(null);
    startTransition(async () => {
      const result = await endRoom(roomId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  if (ended) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          このルームは終了しました
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex justify-center rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-white">
        {/* QR は常に黒/白 (スキャンしやすさ優先で dark mode でも反転しない) */}
        <div
          className="size-[240px]"
          dangerouslySetInnerHTML={{ __html: qrSvg }}
        />
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        {expired
          ? "QR の有効期限が切れています。再生成してください"
          : `QR 有効期限: ${new Date(expiresAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}`}
      </p>

      <div className="flex gap-2">
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
          {copied ? "コピー済み ✓" : "リンクコピー"}
        </Button>
      </div>

      {isCreator ? (
        <div className="flex gap-2">
          <Button
            onClick={regen}
            variant="ghost"
            size="default"
            disabled={pending}
            className="flex-1"
          >
            QR再生成
          </Button>
          <Button
            onClick={end}
            variant="destructive"
            size="default"
            disabled={pending}
            className="flex-1"
          >
            ルーム終了
          </Button>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}
    </section>
  );
}

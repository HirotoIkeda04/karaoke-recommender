"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { createRoom } from "./actions";

export function CreateRoomButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await createRoom();
      if (result.error || !result.roomId) {
        setError(result.error ?? "ルーム作成に失敗しました");
        return;
      }
      router.push(`/rooms/${result.roomId}`);
    });
  };

  return (
    <section className="space-y-2 rounded-2xl border border-pink-200 bg-pink-50 p-4 dark:border-pink-900 dark:bg-pink-950/30">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-pink-900 dark:text-pink-200">
          🎤 カラオケに行く
        </h2>
        <p className="text-xs text-pink-800/80 dark:text-pink-300/80">
          ルームを作成すると、QR を読み込んだ人と歌える曲を共有できます
        </p>
      </div>
      <Button
        onClick={handleClick}
        disabled={pending}
        size="lg"
        className="w-full"
      >
        {pending ? "作成中..." : "ルームを作成"}
      </Button>
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </section>
  );
}

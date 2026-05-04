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
    <section className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={pending}
        size="lg"
        className="w-full"
      >
        {pending ? "作成中..." : "＋ ルームを作成"}
      </Button>
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        QR を読み込んだ人と歌える曲を共有できます
      </p>
      {error ? (
        <p className="text-center text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}

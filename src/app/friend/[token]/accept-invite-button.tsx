"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import { acceptInvite } from "./actions";

interface Props {
  token: string;
  creatorName: string;
}

type DisplayState =
  | { kind: "idle" }
  | { kind: "success"; message: string }
  | { kind: "info"; message: string }
  | { kind: "error"; message: string };

export function AcceptInviteButton({ token, creatorName }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<DisplayState>({ kind: "idle" });

  const handleAccept = () => {
    setState({ kind: "idle" });
    startTransition(async () => {
      const result = await acceptInvite(token);
      if (result.error) {
        setState({ kind: "error", message: result.error });
        return;
      }

      switch (result.status) {
        case "created":
          setState({
            kind: "success",
            message: `${creatorName} さんとフレンドになりました 🎉`,
          });
          break;
        case "already_friends":
          setState({
            kind: "info",
            message: `${creatorName} さんとは既にフレンドです`,
          });
          break;
        case "self":
          setState({
            kind: "error",
            message: "これはあなた自身が発行したリンクです",
          });
          break;
        case "expired":
          setState({
            kind: "error",
            message: "このリンクの有効期限が切れています",
          });
          break;
        case "invalid":
        default:
          setState({
            kind: "error",
            message: "無効なリンクです",
          });
          break;
      }
    });
  };

  if (state.kind === "success" || state.kind === "info") {
    const colorClass =
      state.kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
        : "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200";
    return (
      <div className="space-y-3">
        <p className={`rounded-md border p-3 text-sm ${colorClass}`}>
          {state.message}
        </p>
        <Button
          onClick={() => router.push("/friends")}
          size="lg"
          className="w-full"
        >
          フレンド一覧へ
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Button
        onClick={handleAccept}
        disabled={pending}
        size="lg"
        className="w-full"
      >
        {pending ? "処理中..." : `${creatorName} さんをフレンドに追加`}
      </Button>
      {state.kind === "error" ? (
        <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

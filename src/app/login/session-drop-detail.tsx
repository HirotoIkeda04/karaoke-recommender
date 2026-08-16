"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  formatDuration,
  parseDrop,
  readDropRaw,
  recordDrop,
  serverDropRaw,
  subscribeDrop,
} from "@/lib/auth-session-trace";

/**
 * middleware に「Cookie は届いていたが使えなかった」と判定されて飛ばされて
 * きた時に、意図しないログアウトとして記録し、切り分け用の内訳を出す。
 *
 * ゲスト公開ページで Cookie ごと消えていた場合は AuthDropNotice が拾うので、
 * こちらはログイン画面へ飛ばされる経路 (= stale-cookie) 専用。
 * 原因が確定したらこの表示ごと落とす。
 */
export function SessionDropDetail({ reason }: { reason?: string }) {
  const raw = useSyncExternalStore(subscribeDrop, readDropRaw, serverDropRaw);
  const drop = useMemo(() => parseDrop(raw), [raw]);

  useEffect(() => {
    if (reason !== "stale-cookie") return;
    recordDrop("cookie-unusable");
  }, [reason]);

  if (reason !== "stale-cookie" || !drop) return null;

  return (
    <p className="text-center font-mono text-[10px] text-zinc-500 dark:text-zinc-500">
      {drop.kind} / ログインから {formatDuration(drop.sessionAgeMs)} /
      前回起動から {formatDuration(drop.awayMs)}
    </p>
  );
}

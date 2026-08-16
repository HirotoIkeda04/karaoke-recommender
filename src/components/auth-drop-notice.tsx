"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useIsGuest } from "@/components/session-provider";
import {
  clearLastDrop,
  formatDuration,
  markSignedIn,
  parseDrop,
  readDropRaw,
  recordDrop,
  serverDropRaw,
  subscribeDrop,
} from "@/lib/auth-session-trace";

/**
 * 意図しないログアウトに気づけるようにする。
 *
 * ログイン状態で開いている間は印を残し、ゲストとして描かれた時にその印が
 * 残っていたら「勝手にログアウトされた」と判定して知らせる (src/lib/
 * auth-session-trace.ts)。黙ってゲストのデッキが出るだけだと、本人は
 * ログアウトされたことに気づかないまま評価を localStorage へ貯めてしまう。
 *
 * 併せて、切り分け用の内訳 (Cookie が消えたのか、残っているのに使えないのか /
 * ログインからの経過) も小さく出す。原因が確定したらこの内訳表示は落とす。
 */
export function AuthDropNotice() {
  const isGuest = useIsGuest();
  const pathname = usePathname();
  const raw = useSyncExternalStore(subscribeDrop, readDropRaw, serverDropRaw);
  const drop = useMemo(() => parseDrop(raw), [raw]);

  // 判定と印の更新は localStorage (外部の状態) 側だけで行い、表示は上の
  // ストア購読から反映させる。effect の中で直接 setState はしない。
  useEffect(() => {
    if (isGuest) {
      recordDrop();
      return;
    }
    // ログインし直せた = もう知らせる必要はない
    markSignedIn();
    clearLastDrop();
  }, [isGuest]);

  // ログイン画面の上には出さない (そこでは既に理由を出している)
  if (!drop || pathname === "/login") return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <div className="flex-1 space-y-1">
          <p className="text-sm font-medium">
            セッションが切れてログアウトされています
          </p>
          <p className="text-xs opacity-80">
            このまま付けた評価は、この端末にしか残りません。
          </p>
          <p className="font-mono text-[10px] opacity-60">
            {drop.kind} / ログインから {formatDuration(drop.sessionAgeMs)} /
            前回起動から {formatDuration(drop.awayMs)}
          </p>
          <Link
            href="/login"
            className="inline-flex h-8 items-center rounded-full bg-amber-900 px-3 text-xs font-medium text-amber-50 dark:bg-amber-100 dark:text-amber-950"
          >
            サインインし直す
          </Link>
        </div>
        <button
          type="button"
          onClick={clearLastDrop}
          className="-m-1 p-1 text-xs opacity-60"
          aria-label="閉じる"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { importGuestRatings } from "@/app/(app)/guest-actions";
import { useIsGuest } from "@/components/session-provider";
import { clearGuestRatings, readGuestRatings } from "@/lib/guest-ratings";

/**
 * ログイン済みの状態で localStorage にゲストの評価が残っていたら、
 * DB へ移して localStorage を空にする。
 *
 * ログイン直後だけでなく「ホーム画面に追加してから後でログインした」場合や
 * 「送信に失敗して残ったまま次に開いた」場合にも効くよう、レイアウトに常駐
 * させて毎回チェックする (残っていなければ何もしない)。
 */
export function GuestRatingsImporter() {
  const isGuest = useIsGuest();
  const router = useRouter();
  const runningRef = useRef(false);

  useEffect(() => {
    if (isGuest || runningRef.current) return;

    const entries = Object.entries(readGuestRatings());
    if (entries.length === 0) return;

    runningRef.current = true;
    void (async () => {
      const result = await importGuestRatings(
        entries.map(([songId, entry]) => ({
          songId,
          rating: entry.rating,
          updatedAt: entry.updatedAt,
        })),
      );
      if (result.ok) {
        clearGuestRatings();
        // 引き継いだ評価をライブラリ / デッキに反映させる
        router.refresh();
      } else {
        // 失敗した時は localStorage を残したまま、次に開いた時に再試行する
        runningRef.current = false;
      }
    })();
  }, [isGuest, router]);

  return null;
}

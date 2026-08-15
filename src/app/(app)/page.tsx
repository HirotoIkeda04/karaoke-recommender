import { cookies } from "next/headers";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { DECK_COOKIE, buildDeck } from "@/lib/deck";
import { getGuestDeckGroups } from "@/lib/guest-songs.server";
import { createClient } from "@/lib/supabase/server";

import { GuestRecordDeck } from "./guest-record-deck";
import { RecordDeck } from "./record-deck";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [supabase, cookieStore] = await Promise.all([createClient(), cookies()]);

  // ゲスト (未ログイン) は推薦 RPC を呼べないので、固定の 10 組を出す。
  // 評価済みの除外は localStorage を読めるクライアント側で行う。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) {
    return <GuestRecordDeck groups={getGuestDeckGroups()} />;
  }

  // cookie に前回のシードが残っていればそれを再利用する (タブ切替や
  // アーティストページ往復で推薦が入れ替わらないように)。入れ替わるのは
  // シャッフルボタン・TTL 経過・その組を評価し切った時だけ。
  const deck = await buildDeck(
    supabase,
    cookieStore.get(DECK_COOKIE)?.value ?? null,
  );

  if (deck.groups.length === 0 && deck.error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-600">読み込みエラー</h1>
        <pre className="mt-4 rounded bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          {deck.error}
        </pre>
      </div>
    );
  }

  if (deck.groups.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">代表曲をすべて評価しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          検索ページから他の曲も評価できます。
        </p>
        <Link href="/songs" className={buttonVariants({ size: "lg" })}>
          楽曲を検索する
        </Link>
      </div>
    );
  }

  return (
    <RecordDeck
      initialGroups={deck.groups}
      persistToken={deck.persistToken}
    />
  );
}

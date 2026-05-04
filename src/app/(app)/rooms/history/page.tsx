import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { createClient } from "@/lib/supabase/server";

import { fetchRoomHistoryCards } from "../history-data";
import { RoomHistoryCard } from "../room-history-card";

export const dynamic = "force-dynamic";

// 履歴ページの上限。DB は 90 日保持なので、ここで頭打ちしないと
// アクティブユーザーで肥大化する可能性があるため上限を入れる。
const HISTORY_PAGE_LIMIT = 50;

export default async function RoomHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const cards = await fetchRoomHistoryCards(
    supabase,
    user.id,
    HISTORY_PAGE_LIMIT,
  );

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <div className="flex items-center gap-2">
        <BackButton href="/rooms" label="ルーム一覧に戻る" />
        <h1 className="text-lg font-semibold">ルーム履歴</h1>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        参加から 90 日経過したルームは自動削除されます
      </p>

      {cards.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          まだ参加したルームがありません
        </p>
      ) : (
        <ul className="space-y-2">
          {cards.map((card) => (
            <li key={card.roomId}>
              <RoomHistoryCard {...card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from "next/link";
import { Star } from "lucide-react";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { CreateRoomButton } from "./create-room-button";
import { fetchRoomHistoryCards } from "./history-data";
import { RoomHistoryCard, type HistoryCardProps } from "./room-history-card";

export const dynamic = "force-dynamic";

// インラインに見せる件数。これより多くあれば「もっと見る」を表示。
const HISTORY_INLINE_LIMIT = 5;

export default async function RoomsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // ===== 1. 自分が参加中のアクティブルームがあればそこへリダイレクト =====
  // left_at が null かつルームが未終了なものを最新参加順に 1 件だけ取る。
  const { data: myParticipations } = await supabase
    .from("room_participants")
    .select("room_id, joined_at, rooms!inner(id, ended_at)")
    .eq("user_id", user.id)
    .is("left_at", null)
    .is("rooms.ended_at", null)
    .order("joined_at", { ascending: false })
    .limit(1);

  const activeRoomId = myParticipations?.[0]?.room_id;
  if (activeRoomId) {
    redirect(`/rooms/${activeRoomId}`);
  }

  // ===== 2. 友達がアクティブに開いているルーム =====
  const { data: friendRoomsData } = await supabase.rpc(
    "get_friend_active_rooms",
  );
  const friendRooms = friendRoomsData ?? [];

  // ===== 3. 直近のルーム履歴 =====
  // 多めに取得し、いつもの / 直近 に分割。直近側で +1 余分に判定して
  // 「もっと見る」の表示有無に使う。
  const allHistoryCards = await fetchRoomHistoryCards(
    supabase,
    user.id,
    HISTORY_INLINE_LIMIT + 6, // 余裕枠 (いつものルームを含む可能性)
  );
  const recurringCards = allHistoryCards.filter((c) => c.isRecurring);
  const regularCards = allHistoryCards.filter((c) => !c.isRecurring);
  const hasMore = regularCards.length > HISTORY_INLINE_LIMIT;
  const visibleRegular = regularCards.slice(0, HISTORY_INLINE_LIMIT);

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">ルーム</h1>

      {friendRooms.length > 0 ? (
        <FriendRoomsSection rooms={friendRooms} />
      ) : null}

      <CreateRoomButton />

      {recurringCards.length > 0 ? (
        <RecurringSection cards={recurringCards} />
      ) : null}

      <HistorySection cards={visibleRegular} hasMore={hasMore} />
    </div>
  );
}

interface FriendRoom {
  room_id: string;
  creator_id: string;
  creator_name: string;
  qr_token: string;
  qr_expires_at: string;
  created_at: string;
  participant_count: number;
}

function FriendRoomsSection({ rooms }: { rooms: FriendRoom[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        フレンドが開いているルーム
      </h2>
      <ul className="space-y-2">
        {rooms.map((r) => {
          const expired = new Date(r.qr_expires_at).getTime() < Date.now();
          return (
            <li
              key={r.room_id}
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30"
            >
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-emerald-900 dark:text-emerald-200">
                    {r.creator_name} のルーム
                  </p>
                  <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    参加者 {r.participant_count}人
                    {expired ? " · QR期限切れ" : ""}
                  </p>
                </div>
                {expired ? (
                  <span className="shrink-0 rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:text-emerald-400">
                    参加不可
                  </span>
                ) : (
                  <Link
                    href={`/r/${r.qr_token}`}
                    className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                  >
                    参加
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecurringSection({ cards }: { cards: HistoryCardProps[] }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        <Star
          className="size-4 fill-amber-500 text-amber-500"
          aria-hidden
        />
        いつものルーム
      </h2>
      <ul className="space-y-2">
        {cards.map((card) => (
          <li key={card.roomId}>
            <RoomHistoryCard {...card} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HistorySection({
  cards,
  hasMore,
}: {
  cards: HistoryCardProps[];
  hasMore: boolean;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        直近のルーム
      </h2>

      {cards.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          まだ参加したルームがありません
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {cards.map((card) => (
              <li key={card.roomId}>
                <RoomHistoryCard {...card} />
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="pt-1 text-center">
              <Link
                href="/rooms/history"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                もっと見る ›
              </Link>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

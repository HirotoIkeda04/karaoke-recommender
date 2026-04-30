import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { CreateRoomButton } from "./create-room-button";

export const dynamic = "force-dynamic";

const HISTORY_INLINE_LIMIT = 3;

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

  // ===== 3. 直近のルーム履歴 (自分が過去に参加したルーム) =====
  const { data: historyParts } = await supabase
    .from("room_participants")
    .select("room_id, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false })
    .limit(HISTORY_INLINE_LIMIT);

  const historyRoomIds = (historyParts ?? []).map((p) => p.room_id);

  const { data: historyRooms } =
    historyRoomIds.length > 0
      ? await supabase
          .from("rooms")
          .select("id, creator_id, ended_at, created_at")
          .in("id", historyRoomIds)
      : { data: [] };

  const historyCreatorIds = Array.from(
    new Set((historyRooms ?? []).map((r) => r.creator_id)),
  );
  const historyProfileMap = new Map<string, string>();
  if (historyCreatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", historyCreatorIds);
    for (const p of profiles ?? []) {
      historyProfileMap.set(p.id, p.display_name);
    }
  }

  // joined_at 降順で並び替え
  const historyOrder = new Map(
    (historyParts ?? []).map((p, index) => [p.room_id, index]),
  );
  const sortedHistory = (historyRooms ?? []).slice().sort(
    (a, b) =>
      (historyOrder.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (historyOrder.get(b.id) ?? Number.POSITIVE_INFINITY),
  );

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">ルーム</h1>

      {friendRooms.length > 0 ? (
        <FriendRoomsSection rooms={friendRooms} />
      ) : null}

      <CreateRoomButton />

      <HistorySection
        rooms={sortedHistory}
        currentUserId={user.id}
        profileMap={historyProfileMap}
      />
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
                    className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
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

interface HistoryRoom {
  id: string;
  creator_id: string;
  ended_at: string | null;
  created_at: string;
}

function HistorySection({
  rooms,
  currentUserId,
  profileMap,
}: {
  rooms: HistoryRoom[];
  currentUserId: string;
  profileMap: Map<string, string>;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          直近のルーム履歴
        </h2>
        <Link
          href="/rooms/history"
          className="text-xs font-medium text-zinc-500 hover:underline dark:text-zinc-400"
        >
          すべて見る →
        </Link>
      </div>

      {rooms.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          まだ参加したルームがありません
        </p>
      ) : (
        <ul className="space-y-2">
          {rooms.map((room) => {
            const isMine = room.creator_id === currentUserId;
            const ended = room.ended_at !== null;
            const creatorName = isMine
              ? "あなた"
              : (profileMap.get(room.creator_id) ?? "(不明)");
            const createdAt = new Date(room.created_at);

            return (
              <li
                key={room.id}
                className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {creatorName} のルーム
                      </p>
                      {ended ? (
                        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                          終了
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          進行中
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500">
                      {createdAt.toLocaleString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {" 作成"}
                    </p>
                  </div>
                  <Link
                    href={`/rooms/${room.id}`}
                    className={
                      ended
                        ? "shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                        : "shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    }
                  >
                    {ended ? "確認" : "開く"}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

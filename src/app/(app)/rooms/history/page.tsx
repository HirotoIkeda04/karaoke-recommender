import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 3;

export default async function RoomHistoryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // 自分が参加した直近 3 ルームを joined_at の降順で取得
  const { data: parts } = await supabase
    .from("room_participants")
    .select("room_id, joined_at")
    .eq("user_id", user.id)
    .order("joined_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const roomIds = (parts ?? []).map((p) => p.room_id);

  // ルーム情報をまとめて取得 (creator + 状態)
  const { data: rooms } =
    roomIds.length > 0
      ? await supabase
          .from("rooms")
          .select("id, creator_id, ended_at, created_at, qr_expires_at")
          .in("id", roomIds)
      : { data: [] };

  // creator の display_name 取得
  const creatorIds = Array.from(
    new Set((rooms ?? []).map((r) => r.creator_id)),
  );
  const profileMap = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", creatorIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.display_name);
    }
  }

  // 各ルームのアクティブ参加者数
  const countMap = new Map<string, number>();
  if (roomIds.length > 0) {
    const { data: counts } = await supabase
      .from("room_participants")
      .select("room_id")
      .in("room_id", roomIds)
      .is("left_at", null);
    for (const c of counts ?? []) {
      countMap.set(c.room_id, (countMap.get(c.room_id) ?? 0) + 1);
    }
  }

  // parts の順序 (joined_at 降順) を rooms 配列に反映
  const partOrder = new Map(
    (parts ?? []).map((p, index) => [p.room_id, index]),
  );
  const sortedRooms = (rooms ?? []).slice().sort(
    (a, b) =>
      (partOrder.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (partOrder.get(b.id) ?? Number.POSITIVE_INFINITY),
  );

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">ルーム履歴</h1>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        直近 {HISTORY_LIMIT} 件のみ表示。古いルームは順次自動削除されます
      </p>

      {sortedRooms.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          まだ参加したルームがありません
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedRooms.map((room) => {
            const isMine = room.creator_id === user.id;
            const ended = room.ended_at !== null;
            const creatorName = isMine
              ? "あなた"
              : (profileMap.get(room.creator_id) ?? "(不明)");
            const activeCount = countMap.get(room.id) ?? 0;
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
                      {" · "}
                      参加者 {activeCount}人
                    </p>
                  </div>
                  {!ended ? (
                    <Link
                      href={`/rooms/${room.id}`}
                      className="shrink-0 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      開く
                    </Link>
                  ) : (
                    <Link
                      href={`/rooms/${room.id}`}
                      className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      確認
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

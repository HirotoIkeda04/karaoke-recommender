import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { HistoryCardProps } from "./room-history-card";

/**
 * 自分が過去に参加したルームを最新参加順で limit 件取得し、
 * RoomHistoryCard が必要とする整形済プロパティ配列を返す。
 *
 * 集約ステップ:
 *  1. room_participants から自分の最新 limit 件 (joined_at DESC)
 *  2. 該当 rooms (id, ended_at, created_at)
 *  3. 該当 rooms 全参加者 (user_id, guest_name) — アバター + 人数算出用
 *  4. 参加者の profiles (display_name, icon_color)
 */
export async function fetchRoomHistoryCards(
  supabase: SupabaseClient<Database>,
  currentUserId: string,
  limit: number,
): Promise<HistoryCardProps[]> {
  const { data: myParts } = await supabase
    .from("room_participants")
    .select("room_id, joined_at")
    .eq("user_id", currentUserId)
    .order("joined_at", { ascending: false })
    .limit(limit);

  const roomIds = (myParts ?? []).map((p) => p.room_id);
  if (roomIds.length === 0) return [];

  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, ended_at, created_at, is_recurring")
    .in("id", roomIds);

  const { data: allParts } = await supabase
    .from("room_participants")
    .select("room_id, user_id, guest_name, joined_at")
    .in("room_id", roomIds)
    .order("joined_at", { ascending: true });

  const userIds = new Set<string>();
  for (const p of allParts ?? []) {
    if (p.user_id) userIds.add(p.user_id);
  }

  const profileById = new Map<
    string,
    { name: string; iconColor: string | null }
  >();
  if (userIds.size > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, icon_color")
      .in("id", Array.from(userIds));
    for (const p of profiles ?? []) {
      profileById.set(p.id, { name: p.display_name, iconColor: p.icon_color });
    }
  }

  // room_id -> 重複排除済の参加者リスト (joined_at 昇順)
  const partsByRoom = new Map<
    string,
    Array<{ user_id: string | null; guest_name: string | null }>
  >();
  for (const p of allParts ?? []) {
    const key = p.user_id ?? `g:${p.guest_name ?? ""}`;
    const list = partsByRoom.get(p.room_id) ?? [];
    if (
      !list.some((x) => (x.user_id ?? `g:${x.guest_name ?? ""}`) === key)
    ) {
      list.push({ user_id: p.user_id, guest_name: p.guest_name });
      partsByRoom.set(p.room_id, list);
    }
  }

  // 自分の参加順で並び替えるための index map
  const order = new Map(
    (myParts ?? []).map((p, i) => [p.room_id, i] as const),
  );

  return (rooms ?? [])
    .slice()
    .sort(
      (a, b) =>
        (order.get(a.id) ?? Number.POSITIVE_INFINITY) -
        (order.get(b.id) ?? Number.POSITIVE_INFINITY),
    )
    .map((room) => {
      const allRoomParts = partsByRoom.get(room.id) ?? [];
      // 自分を先頭に持ってくる (アバターで自分が一目で分かるように)。
      const sortedParts = allRoomParts.slice().sort((a, b) => {
        const aSelf = a.user_id === currentUserId ? 0 : 1;
        const bSelf = b.user_id === currentUserId ? 0 : 1;
        return aSelf - bSelf;
      });
      return {
        roomId: room.id,
        createdAt: room.created_at,
        ended: room.ended_at !== null,
        isRecurring: room.is_recurring,
        participantCount: allRoomParts.length,
        participants: sortedParts.map((p) => ({
          userId: p.user_id,
          name: p.user_id
            ? (profileById.get(p.user_id)?.name ?? "(不明)")
            : (p.guest_name ?? "ゲスト"),
          iconColor: p.user_id
            ? (profileById.get(p.user_id)?.iconColor ?? null)
            : null,
          isSelf: p.user_id === currentUserId,
        })),
      };
    });
}

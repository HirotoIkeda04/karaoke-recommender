"use server";

import { randomBytes } from "node:crypto";

import { createClient } from "@/lib/supabase/server";

const QR_TTL_MINUTES = 30;

export interface CreateRoomResult {
  roomId: string | null;
  error: string | null;
}

export async function createRoom(): Promise<CreateRoomResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { roomId: null, error: "未認証です" };

  // 16 byte 乱数 = 22 文字の URL-safe トークン (QR用)
  const qrToken = randomBytes(16).toString("base64url");
  const qrExpiresAt = new Date();
  qrExpiresAt.setMinutes(qrExpiresAt.getMinutes() + QR_TTL_MINUTES);

  const { data: room, error: roomError } = await supabase
    .from("rooms")
    .insert({
      creator_id: user.id,
      qr_token: qrToken,
      qr_expires_at: qrExpiresAt.toISOString(),
    })
    .select("id")
    .single();

  if (roomError || !room) {
    return {
      roomId: null,
      error: roomError?.message ?? "ルーム作成に失敗しました",
    };
  }

  // 作成者を自動参加
  const { error: partError } = await supabase
    .from("room_participants")
    .insert({ room_id: room.id, user_id: user.id });

  if (partError) {
    // ロールバック
    await supabase.from("rooms").delete().eq("id", room.id);
    return { roomId: null, error: partError.message };
  }

  return { roomId: room.id, error: null };
}

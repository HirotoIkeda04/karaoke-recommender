"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const QR_TTL_MINUTES = 30;

export interface MutateRoomResult {
  error: string | null;
}

export async function regenerateQr(
  roomId: string,
): Promise<MutateRoomResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未認証です" };

  const qrToken = randomBytes(16).toString("base64url");
  const qrExpiresAt = new Date();
  qrExpiresAt.setMinutes(qrExpiresAt.getMinutes() + QR_TTL_MINUTES);

  // RLS が creator のみに UPDATE を許可するので追加チェック不要
  const { error } = await supabase
    .from("rooms")
    .update({
      qr_token: qrToken,
      qr_expires_at: qrExpiresAt.toISOString(),
    })
    .eq("id", roomId);

  if (error) return { error: error.message };
  revalidatePath(`/rooms/${roomId}`);
  return { error: null };
}

export async function endRoom(roomId: string): Promise<MutateRoomResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未認証です" };

  const { error } = await supabase
    .from("rooms")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", roomId);

  if (error) return { error: error.message };
  revalidatePath(`/rooms/${roomId}`);
  return { error: null };
}

export async function setRoomRecurring(
  roomId: string,
  isRecurring: boolean,
): Promise<MutateRoomResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未認証です" };

  // RLS が creator のみに UPDATE を許可するので追加チェック不要
  const { error } = await supabase
    .from("rooms")
    .update({ is_recurring: isRecurring })
    .eq("id", roomId);

  if (error) return { error: error.message };
  revalidatePath(`/rooms/${roomId}`);
  revalidatePath(`/rooms`);
  revalidatePath(`/rooms/history`);
  return { error: null };
}

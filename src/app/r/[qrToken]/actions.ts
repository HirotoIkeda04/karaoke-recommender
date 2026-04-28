"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const GUEST_COOKIE_PREFIX = "guest_token_";
const GUEST_COOKIE_TTL_SECONDS = 60 * 60 * 8; // 8h (ルームの強制タイムアウトと一致)

export interface JoinAsGuestResult {
  // 'joined_guest' | 'rejoined' | 'expired' | 'ended' | 'invalid'
  status: string | null;
  error: string | null;
}

export async function joinAsGuest(
  qrToken: string,
  guestName: string,
): Promise<JoinAsGuestResult> {
  const trimmed = guestName.trim();
  if (!trimmed) {
    return { status: null, error: "表示名を入力してください" };
  }
  if (trimmed.length > 32) {
    return { status: null, error: "32文字以内で入力してください" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_room_by_qr", {
    p_qr_token: qrToken,
    p_guest_name: trimmed,
  });

  if (error) return { status: null, error: error.message };

  const result = data?.[0];
  if (!result) return { status: null, error: "RPC のレスポンスが空でした" };

  // 新規ゲスト参加: guest_token を Cookie 保存して再描画時に再入室扱いにする
  if (result.status === "joined_guest" && result.guest_token) {
    const cookieStore = await cookies();
    cookieStore.set({
      name: `${GUEST_COOKIE_PREFIX}${qrToken}`,
      value: result.guest_token,
      maxAge: GUEST_COOKIE_TTL_SECONDS,
      sameSite: "lax",
      path: "/",
      // ゲストの guest_token は本人のブラウザでだけ使う想定なので httpOnly で良い
      httpOnly: true,
    });
  }

  revalidatePath(`/r/${qrToken}`);
  return { status: result.status, error: null };
}

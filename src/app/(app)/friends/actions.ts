"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

const INVITE_LINK_TTL_DAYS = 7;

export interface CreateInviteLinkResult {
  // path 形式 (/friend/<token>)。完全 URL 化はクライアント側で window.location.origin を使う
  path: string | null;
  expiresAt: string | null;
  error: string | null;
}

export async function createInviteLink(): Promise<CreateInviteLinkResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { path: null, expiresAt: null, error: "未認証です" };

  // URL-safe 24 byte 乱数 (base64url エンコードで 32 文字)
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_LINK_TTL_DAYS);

  const { error } = await supabase.from("friend_invite_links").insert({
    token,
    creator_id: user.id,
    expires_at: expiresAt.toISOString(),
  });

  if (error) return { path: null, expiresAt: null, error: error.message };

  return {
    path: `/friend/${token}`,
    expiresAt: expiresAt.toISOString(),
    error: null,
  };
}

export interface MutateFriendshipResult {
  error: string | null;
}

export async function acceptFriendRequest(
  otherUserId: string,
): Promise<MutateFriendshipResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未認証です" };

  // a < b 正規化 (DB 側の制約と一致させる)
  const [a, b] =
    user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];

  const { error } = await supabase
    .from("friendships")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("user_a_id", a)
    .eq("user_b_id", b);

  if (error) return { error: error.message };
  revalidatePath("/friends");
  return { error: null };
}

// 拒否 = 受信した申請を削除 / 取消 = 送信した申請を削除 (どちらも DELETE)
async function deleteFriendship(
  otherUserId: string,
): Promise<MutateFriendshipResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "未認証です" };

  const [a, b] =
    user.id < otherUserId ? [user.id, otherUserId] : [otherUserId, user.id];

  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("user_a_id", a)
    .eq("user_b_id", b);

  if (error) return { error: error.message };
  revalidatePath("/friends");
  revalidatePath("/library");
  return { error: null };
}

export async function rejectFriendRequest(otherUserId: string) {
  return deleteFriendship(otherUserId);
}

export async function cancelOutgoingRequest(otherUserId: string) {
  return deleteFriendship(otherUserId);
}

export async function removeFriend(otherUserId: string) {
  return deleteFriendship(otherUserId);
}

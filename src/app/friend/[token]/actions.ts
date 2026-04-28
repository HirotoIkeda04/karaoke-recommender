"use server";

import { createClient } from "@/lib/supabase/server";

export interface AcceptInviteResult {
  // RPC accept_friend_invite の戻り status:
  // 'created' | 'already_friends' | 'self' | 'expired' | 'invalid'
  status: string | null;
  error: string | null;
}

export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_friend_invite", {
    p_token: token,
  });

  if (error) return { status: null, error: error.message };

  const row = data?.[0];
  if (!row) return { status: null, error: "RPC のレスポンスが空でした" };

  return { status: row.status, error: null };
}

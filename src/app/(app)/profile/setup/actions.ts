"use server";

import { createClient } from "@/lib/supabase/server";

export interface UpdateDisplayNameResult {
  error: string | null;
}

export async function updateDisplayName(
  name: string,
): Promise<UpdateDisplayNameResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "表示名を入力してください" };
  }
  if (trimmed.length > 32) {
    return { error: "32文字以内で入力してください" };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { error: "未認証です" };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", user.id);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

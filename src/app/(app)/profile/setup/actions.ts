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

  // .select() を付けると RETURNING * 相当で更新行が返る → 0 件かどうか判定可能
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", user.id)
    .select("id");

  if (error) {
    return { error: error.message };
  }

  if (!data || data.length === 0) {
    // 通常は migration 007 のトリガ + 009 のバックフィルでカバーされるが、
    // 念のため: profile 行が無い場合は明示的にエラーを返す
    return {
      error:
        "プロフィール行が見つかりませんでした。管理者にお問い合わせください。",
    };
  }

  return { error: null };
}

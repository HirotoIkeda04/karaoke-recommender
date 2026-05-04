"use server";

import { redirect } from "next/navigation";

import { isIconColor } from "@/lib/icon-color";
import { createClient } from "@/lib/supabase/server";

export interface UpdateProfileResult {
  error: string | null;
}

// ユーザーネーム + アイコン色をまとめて保存して `next` に redirect する。
// upsert を使うのは、何らかの理由で profiles 行が存在しないユーザー
// (古いアカウント、trigger 失敗など) でも初回保存できるようにするため。
// 成功時は redirect(next) が NEXT_REDIRECT を throw するので以降は実行されない。
export async function updateProfile(
  name: string,
  iconColor: string,
  next: string,
): Promise<UpdateProfileResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "ユーザーネームを入力してください" };
  }
  if (trimmed.length > 32) {
    return { error: "32文字以内で入力してください" };
  }
  if (!isIconColor(iconColor)) {
    return { error: "無効なアイコン色が選択されています" };
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
    .upsert(
      { id: user.id, display_name: trimmed, icon_color: iconColor },
      { onConflict: "id" },
    );

  if (error) {
    return { error: error.message };
  }

  redirect(next);
}

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// /admin/* アクセスを ADMIN_EMAIL に一致する認証済みユーザーのみに制限。
// レイアウトと Server Action の両方から呼び、多層防御する。
export async function requireAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    // 設定漏れ。サイレント許可は危険なので redirect で拒否。
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.email !== adminEmail) {
    redirect("/");
  }

  return user;
}

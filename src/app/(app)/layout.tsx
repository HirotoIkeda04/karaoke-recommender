import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppBottomNav } from "@/components/app-bottom-nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  // パフォーマンス最適化: 表示用ユーザー情報なら getSession で十分。
  // 書き込み権限が必要な server action (rateSong 等) は getUser で再検証する。
  // 詳細は src/lib/supabase/middleware.ts のコメント参照。
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user ?? null;

  // middleware で防がれる想定だが、二重防御
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader user={user} />
      <main className="flex-1 pb-20">{children}</main>
      <AppBottomNav />
    </div>
  );
}

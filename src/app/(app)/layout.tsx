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
    // min-h-dvh: 動的ビューポート高 (iOS Safari の URL バー伸縮に追従、
    //   100vh のような固定値ではなく現在の表示領域を毎フレーム反映する)
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={user} />
      {/* main の bottom padding: BottomNav の高さ (~5rem) + ホームインジケータ safe-area */}
      {/* flex flex-col: 子ページが flex-1 で main 全体を埋められるようにする
         (例: 評価デッキ / でカードを画面高に合わせる) */}
      <main className="flex flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <AppBottomNav />
    </div>
  );
}

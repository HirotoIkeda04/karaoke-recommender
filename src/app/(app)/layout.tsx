import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppBottomNav } from "@/components/app-bottom-nav";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
  songSheet,
}: {
  children: React.ReactNode;
  songSheet: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // middleware で防がれる想定だが、二重防御
  if (!session?.user) {
    redirect("/login");
  }

  return (
    // min-h-dvh: 動的ビューポート高 (iOS Safari の URL バー伸縮に追従、
    //   100vh のような固定値ではなく現在の表示領域を毎フレーム反映する)
    <div className="flex min-h-dvh flex-col">
      <AppHeader />
      {/* main の bottom padding: 浮いた BottomNav (バー 3.5rem + 下の余白
          max(0.75rem, safe-area)) を必ず上回る値。5rem + safe-area なら
          safe-area の有無どちらでも 0.75rem 以上のクリアランスが残る。 */}
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <AppBottomNav />
      {songSheet}
    </div>
  );
}

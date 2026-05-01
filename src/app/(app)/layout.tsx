import { redirect } from "next/navigation";

import { AppHeader } from "@/components/app-header";
import { AppBottomNav } from "@/components/app-bottom-nav";
import { InstallPrompt } from "@/components/install-prompt";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
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
      {/* main の bottom padding: BottomNav の高さ (~5rem) + ホームインジケータ safe-area */}
      <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <AppBottomNav />
      <InstallPrompt />
    </div>
  );
}

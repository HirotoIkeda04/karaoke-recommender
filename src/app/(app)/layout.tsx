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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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

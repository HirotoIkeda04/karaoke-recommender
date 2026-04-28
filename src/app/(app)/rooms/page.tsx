import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { CreateRoomButton } from "./create-room-button";

export const dynamic = "force-dynamic";

export default async function RoomsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">ルーム</h1>
      <CreateRoomButton />
    </div>
  );
}

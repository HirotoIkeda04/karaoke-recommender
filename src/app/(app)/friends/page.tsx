import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { FriendList, type FriendItem } from "./friend-list";
import { InviteLinkSection } from "./invite-link-section";

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: friendships, error: friendshipsError } = await supabase
    .from("friendships")
    .select("user_a_id, user_b_id, status, requested_by_id")
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);

  if (friendshipsError) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-600">読み込みエラー</h1>
        <pre className="mt-4 rounded bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          {friendshipsError.message}
        </pre>
      </div>
    );
  }

  const otherIds = (friendships ?? []).map((f) =>
    f.user_a_id === user.id ? f.user_b_id : f.user_a_id,
  );

  // profiles を別クエリで取得 (3 通りの FK を持つので JOIN ヒント記述が煩雑なため)
  const profileMap = new Map<string, string>();
  if (otherIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", otherIds);
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p.display_name);
    }
  }

  const accepted: FriendItem[] = [];
  const incoming: FriendItem[] = [];
  const outgoing: FriendItem[] = [];

  for (const f of friendships ?? []) {
    const otherId = f.user_a_id === user.id ? f.user_b_id : f.user_a_id;
    const item: FriendItem = {
      otherId,
      otherName: profileMap.get(otherId) ?? "(不明なユーザー)",
    };
    if (f.status === "accepted") {
      accepted.push(item);
    } else if (f.requested_by_id === user.id) {
      outgoing.push(item);
    } else {
      incoming.push(item);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-5 px-4 py-4">
      <h1 className="text-lg font-semibold">フレンド</h1>

      <InviteLinkSection />

      <FriendList
        accepted={accepted}
        incoming={incoming}
        outgoing={outgoing}
      />
    </div>
  );
}

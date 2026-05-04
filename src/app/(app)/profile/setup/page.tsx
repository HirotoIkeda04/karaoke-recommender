import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { createClient } from "@/lib/supabase/server";

import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

interface SetupPageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function ProfileSetupPage({
  searchParams,
}: SetupPageProps) {
  const params = await searchParams;
  // デフォルトはライブラリ。プロフィール編集導線がライブラリ起点なため。
  // OAuth コールバック等から ?next= が明示されていればそれを優先。
  const next = params.next ?? "/library";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, icon_color")
    .eq("id", user.id)
    .maybeSingle();

  // 仮の display_name (例: "ユーザー A3F2") は初期値から除外し、空欄から入力させる
  const isDefaultName =
    profile?.display_name != null &&
    /^ユーザー [0-9A-F]{4}$/.test(profile.display_name);
  const initialName = isDefaultName ? "" : (profile?.display_name ?? "");

  return (
    <div className="mx-auto max-w-md p-6">
      <div className="mb-4">
        <BackButton fallbackHref={next} />
      </div>
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          ユーザーネームの設定
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          フレンドやカラオケルームの参加者に表示される名前です。あとから変更できます。
        </p>
      </div>

      <ProfileForm
        initialName={initialName}
        initialColor={profile?.icon_color ?? null}
        next={next}
      />
    </div>
  );
}

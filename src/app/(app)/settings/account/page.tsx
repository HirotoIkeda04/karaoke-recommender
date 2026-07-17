import { redirect } from "next/navigation";

import { BackButton } from "@/components/back-button";
import { SignOutButton } from "@/components/sign-out-button";
import { createClient } from "@/lib/supabase/server";

import {
  IdentityManager,
  type LinkedIdentity,
} from "./identity-manager";

export const dynamic = "force-dynamic";

interface AccountSettingsPageProps {
  searchParams: Promise<{
    linked?: string;
    error?: string;
  }>;
}

function toLinkedIdentity(identity: {
  identity_id: string;
  provider: string;
  identity_data?: Record<string, unknown>;
  created_at?: string;
  last_sign_in_at?: string;
}): LinkedIdentity {
  const email = identity.identity_data?.email;

  return {
    identityId: identity.identity_id,
    provider: identity.provider,
    email: typeof email === "string" ? email : null,
    createdAt: identity.created_at ?? null,
    lastSignInAt: identity.last_sign_in_at ?? null,
  };
}

export default async function AccountSettingsPage({
  searchParams,
}: AccountSettingsPageProps) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/settings/account");

  const { data, error } = await supabase.auth.getUserIdentities();
  const identities = (data?.identities ?? user.identities ?? []).map(
    toLinkedIdentity,
  );

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-4">
      <div className="flex items-center gap-2">
        <BackButton href="/library" label="ライブラリに戻る" />
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          アカウント
        </h1>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
          ログインできるGoogleアカウント
        </h2>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          ここに追加したGoogleアカウントは、どれを使っても同じKyokuMokuアカウントにログインできます。評価・フレンド・履歴は共通です。
        </p>
      </section>

      <IdentityManager
        initialIdentities={identities}
        initialError={error?.message ?? params.error ?? null}
        linked={params.linked === "1"}
      />

      <p className="rounded-2xl bg-zinc-100 px-4 py-3 text-xs leading-relaxed text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
        すでに別のKyokuMokuアカウントに登録されているGoogleアカウントは、そのままでは追加できません。データを統合する必要があるため、個別のアカウント統合として扱います。
      </p>

      <section className="border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <SignOutButton />
      </section>
    </div>
  );
}

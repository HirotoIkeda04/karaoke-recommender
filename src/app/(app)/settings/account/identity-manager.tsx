"use client";

import { Link2, LoaderCircle, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

export interface LinkedIdentity {
  identityId: string;
  provider: string;
  email: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
}

interface IdentityManagerProps {
  initialIdentities: LinkedIdentity[];
  initialError: string | null;
  linked: boolean;
}

function friendlyLinkError(message: string): string {
  const normalized = message.toLowerCase();

  if (/[぀-ヿ㐀-鿿]/.test(message)) {
    return message;
  }

  if (
    normalized.includes("already") &&
    (normalized.includes("linked") || normalized.includes("registered"))
  ) {
    return "このGoogleアカウントは、すでに別のKyokuMokuアカウントで使われています。アカウント統合が必要です。";
  }

  if (
    normalized.includes("manual linking") ||
    normalized.includes("identity linking")
  ) {
    return "Googleアカウントの追加機能が現在無効です。管理者にお問い合わせください。";
  }

  return "処理を完了できませんでした。時間を置いてもう一度お試しください。";
}

function providerLabel(provider: string): string {
  return provider === "google" ? "Google" : provider;
}

export function IdentityManager({
  initialIdentities,
  initialError,
  linked,
}: IdentityManagerProps) {
  const router = useRouter();
  const [identities, setIdentities] = useState(initialIdentities);
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(
    initialError ? friendlyLinkError(initialError) : null,
  );

  const startLinking = async () => {
    setLinking(true);
    setError(null);

    const supabase = createClient();
    const redirectTo = new URL(
      "/auth/link/callback",
      window.location.origin,
    ).toString();
    const { error: linkError } = await supabase.auth.linkIdentity({
      provider: "google",
      options: {
        redirectTo,
        scopes: "openid email",
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (linkError) {
      setError(friendlyLinkError(linkError.message));
      setLinking(false);
    }
  };

  const unlink = async (identityId: string) => {
    setUnlinkingId(identityId);
    setError(null);

    const supabase = createClient();
    const { data, error: refreshError } =
      await supabase.auth.getUserIdentities();

    if (refreshError) {
      setError(friendlyLinkError(refreshError.message));
      setUnlinkingId(null);
      return;
    }

    const currentIdentities = data?.identities ?? [];
    if (currentIdentities.length <= 1) {
      setError("ログイン手段を残すため、最後のGoogleアカウントは解除できません。");
      setUnlinkingId(null);
      setConfirmingId(null);
      return;
    }

    const target = currentIdentities.find(
      (identity) => identity.identity_id === identityId,
    );
    if (!target) {
      setError("対象のGoogleアカウントが見つかりませんでした。画面を更新してお試しください。");
      setUnlinkingId(null);
      setConfirmingId(null);
      return;
    }

    const { error: unlinkError } = await supabase.auth.unlinkIdentity(target);
    if (unlinkError) {
      setError(friendlyLinkError(unlinkError.message));
      setUnlinkingId(null);
      return;
    }

    setIdentities((current) =>
      current.filter((identity) => identity.identityId !== identityId),
    );
    setConfirmingId(null);
    setUnlinkingId(null);
    router.refresh();
  };

  return (
    <section className="space-y-4">
      {linked ? (
        <p
          role="status"
          className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
        >
          Googleアカウントを追加しました。
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-2xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {identities.map((identity) => {
          const isLastIdentity = identities.length <= 1;
          const confirming = confirmingId === identity.identityId;
          const unlinking = unlinkingId === identity.identityId;

          return (
            <li key={identity.identityId} className="space-y-3 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
                  <span className="text-base font-semibold text-[#4285f4]">G</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                    {providerLabel(identity.provider)}
                  </p>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {identity.email ?? "メールアドレスを取得できません"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmingId(identity.identityId)}
                  disabled={isLastIdentity || unlinking}
                  aria-label={`${identity.email ?? "Googleアカウント"}の連携を解除`}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-zinc-900 dark:hover:text-red-400"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>

              {confirming ? (
                <div className="rounded-xl bg-zinc-100 p-3 dark:bg-zinc-900">
                  <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
                    このGoogleアカウントからはログインできなくなります。評価などのデータは削除されません。
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmingId(null)}
                      disabled={unlinking}
                      className="flex-1 rounded-full bg-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => void unlink(identity.identityId)}
                      disabled={unlinking}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-red-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {unlinking ? (
                        <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
                      ) : null}
                      解除する
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={() => void startLinking()}
        disabled={linking || unlinkingId !== null}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-zinc-900 px-4 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {linking ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <Link2 className="size-4" aria-hidden />
        )}
        {linking ? "Googleへ移動しています…" : "Googleアカウントを追加"}
      </button>

      {identities.length <= 1 ? (
        <p className="text-center text-xs text-zinc-500 dark:text-zinc-400">
          最後のログイン手段は解除できません。
        </p>
      ) : null}
    </section>
  );
}

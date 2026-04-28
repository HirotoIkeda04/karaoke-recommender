import Link from "next/link";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

import { AcceptInviteButton } from "./accept-invite-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function FriendInvitePage({ params }: PageProps) {
  const { token } = await params;

  const supabase = await createClient();

  // RPC は anon でも呼べる (招待リンク着地ページのため)
  const { data, error } = await supabase.rpc("get_friend_invite_info", {
    p_token: token,
  });

  const info = data?.[0];

  if (error || !info) {
    return (
      <ErrorScreen
        title="リンクが見つかりません"
        message="リンクが正しいか、まだ有効か確認してください。"
      />
    );
  }

  if (!info.is_valid) {
    return (
      <ErrorScreen
        title="有効期限切れ"
        message="このリンクは期限切れです。発行者に新しいリンクを依頼してください。"
      />
    );
  }

  // ログイン状態確認
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 自分自身が発行したリンク
  if (user && user.id === info.creator_id) {
    return (
      <ErrorScreen
        title="自分のリンクです"
        message="これはあなた自身が発行したリンクです。他の人に共有してください。"
      />
    );
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            カラオケアプリ
          </p>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            フレンド申請
          </h1>
        </div>

        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {info.creator_name}
            </span>
            <br />
            さんからのフレンド申請です
          </p>
        </div>

        {user ? (
          <AcceptInviteButton token={token} creatorName={info.creator_name} />
        ) : (
          <div className="space-y-3">
            <Link
              href={`/login?next=${encodeURIComponent(`/friend/${token}`)}`}
              className="block"
            >
              <Button size="lg" className="w-full">
                ログインしてフレンドになる
              </Button>
            </Link>
            <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
              Google アカウントでログインします
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

function ErrorScreen({ title, message }: { title: string; message: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-50">
          {title}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p>
        <Link href="/" className="block">
          <Button variant="outline" size="lg" className="w-full">
            ホームに戻る
          </Button>
        </Link>
      </div>
    </main>
  );
}

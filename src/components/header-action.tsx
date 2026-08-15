"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { InstallButton } from "@/components/install-button";
import { useIsGuest } from "@/components/session-provider";

/**
 * ヘッダー右端のボタン。1 枠を状態で使い分ける:
 *
 *   未ログイン         … 「ログインする」
 *   ログイン済み・未追加 … 「ホーム画面に追加」
 *   ログイン済み・追加済み … 何も出さない
 *
 * ゲストの判定を PWA インストール判定より先に置いてあるのは、ホーム画面へ
 * 追加してからログインしようとする人のため。standalone 起動でも未ログインなら
 * ログイン導線が出る (追加済みの人に「ホーム画面に追加」を出しても意味がない)。
 */
export function HeaderAction() {
  const isGuest = useIsGuest();
  const pathname = usePathname();

  if (!isGuest) return <InstallButton />;

  // ログイン後は元居たページへ戻す。クエリは落とす (useSearchParams を使うと
  // ヘッダーが全ページで Suspense 境界を要求するため、そこまではしない)。
  return (
    <Link
      href={`/login?next=${encodeURIComponent(pathname)}`}
      className="ml-auto rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      ログインする
    </Link>
  );
}

import Link from "next/link";

import { Button } from "@/components/ui/button";

interface PageProps {
  searchParams: Promise<{ name?: string }>;
}

export default async function FriendRemovedPage({ searchParams }: PageProps) {
  const { name } = await searchParams;
  const displayName = name?.trim() || "フレンド";

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12 text-center">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {displayName} さんとのフレンドを解除しました
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          お互いのライブラリは見られなくなります。再度フレンドになるには、もう一度招待リンクからつながる必要があります。
        </p>
      </div>

      <Link href="/library" className="block">
        <Button variant="outline" size="lg" className="w-full">
          ライブラリに戻る
        </Button>
      </Link>
    </div>
  );
}

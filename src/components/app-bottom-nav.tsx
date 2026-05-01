"use client";

import { Home, LibraryBig, Mic, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/songs", label: "検索", icon: Search },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/rooms", label: "ルーム", icon: Mic },
] as const;

export function AppBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 bg-black px-2 pt-1"
      // ホームインジケータ領域を避けつつ、最低限の bottom padding を確保
      style={{
        paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* grid grid-cols-4 で 4 タブを必ず等分。
          各タブの中心が画面の 1/8, 3/8, 5/8, 7/8 に常に固定される。
          ※ プロフィール (旧「音域」タブ) は /library に集約。
            フレンド管理は /library のプロフィール内リンクから /friends へ遷移。 */}
      <ul className="mx-auto grid max-w-md grid-cols-4">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="min-w-0">
              <Link
                href={item.href}
                className={cn(
                  "flex w-full flex-col items-center gap-0.5 px-1 py-1.5 text-[10px] whitespace-nowrap",
                  active ? "text-white" : "text-zinc-400",
                )}
              >
                <Icon className="size-6" aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

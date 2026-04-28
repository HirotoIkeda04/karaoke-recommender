"use client";

import { Home, LibraryBig, Search, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/songs", label: "検索", icon: Search },
  { href: "/library", label: "ライブラリ", icon: LibraryBig },
  { href: "/friends", label: "フレンド", icon: Users },
  { href: "/profile", label: "音域", icon: User },
] as const;

export function AppBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 px-2 pt-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95"
      // ホームインジケータ領域を避けつつ、最低限の bottom padding を確保
      style={{
        paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))",
      }}
    >
      {/* grid grid-cols-5 で 5 タブを必ず等分。
          ラベル長(評価/検索/ライブラリ/フレンド/音域)に依存せず、
          各タブの中心が画面の 1/10, 3/10, 5/10, 7/10, 9/10 に常に固定される。
          ※ フレンド追加で 4→5 タブ化。「マイライブラリ」は字数の都合で「ライブラリ」に変更。 */}
      <ul className="mx-auto grid max-w-md grid-cols-5">
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
                  active
                    ? "text-pink-600 dark:text-pink-400"
                    : "text-zinc-500 dark:text-zinc-400",
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

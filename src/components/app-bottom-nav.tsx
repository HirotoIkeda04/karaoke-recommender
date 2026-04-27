"use client";

import { Home, Search, Star, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/", label: "評価", icon: Home },
  { href: "/songs", label: "検索", icon: Search },
  { href: "/library", label: "履歴", icon: Star },
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
      <ul className="mx-auto flex max-w-md justify-around">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-0.5 px-4 py-2 text-xs",
                  active
                    ? "text-pink-600 dark:text-pink-400"
                    : "text-zinc-500 dark:text-zinc-400",
                )}
              >
                <Icon className="size-5" aria-hidden />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

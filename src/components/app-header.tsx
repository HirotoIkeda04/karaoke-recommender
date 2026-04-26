import type { User } from "@supabase/supabase-js";

import { SignOutButton } from "@/components/sign-out-button";

interface AppHeaderProps {
  user: User;
}

export function AppHeader({ user }: AppHeaderProps) {
  const name =
    (user.user_metadata?.name as string | undefined) ??
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "ユーザー";
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        カラオケ評価
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={name}
              className="size-7 rounded-full border border-zinc-200 dark:border-zinc-700"
            />
          ) : (
            <div className="flex size-7 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium dark:bg-zinc-700">
              {name.slice(0, 1)}
            </div>
          )}
          <span className="hidden text-sm text-zinc-700 sm:inline dark:text-zinc-300">
            {name}
          </span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}

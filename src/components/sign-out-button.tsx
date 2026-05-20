import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        aria-label="サインアウト"
        className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-zinc-700 hover:bg-zinc-300 active:bg-zinc-300 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 dark:active:bg-zinc-800"
      >
        <LogOut className="size-4" />
      </button>
    </form>
  );
}

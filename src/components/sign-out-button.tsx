import { LogOut } from "lucide-react";

export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        aria-label="サインアウト"
        className="rounded p-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        <LogOut className="size-4" />
      </button>
    </form>
  );
}

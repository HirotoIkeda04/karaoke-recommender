import { GoogleLoginButton } from "./google-login-button";

interface LoginPageProps {
  searchParams: Promise<{ next?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params.next ?? "/";
  const error = params.error;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            SetoriSetolu
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Google アカウントでサインインしてください
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {decodeURIComponent(error)}
          </div>
        ) : null}

        <GoogleLoginButton next={next} />

        <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
          サインインすることで、評価データが Supabase に保存されます
        </p>
      </div>
    </main>
  );
}

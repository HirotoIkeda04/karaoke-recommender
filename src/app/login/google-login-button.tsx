"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface GoogleLoginButtonProps {
  next: string;
}

export function GoogleLoginButton({ next }: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: callback.toString(),
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // 成功時は Supabase が Google のページへ遷移させるので、ここから戻ることは無い
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={loading}
        className="w-full"
        size="lg"
      >
        {loading ? "リダイレクト中..." : "Google でサインイン"}
      </Button>
      {error ? (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";

import { InAppBrowserNotice } from "@/components/in-app-browser-notice";
import { Button } from "@/components/ui/button";
import { useInAppBrowser } from "@/hooks/use-in-app-browser";
import { createClient } from "@/lib/supabase/client";

interface GoogleLoginButtonProps {
  next: string;
}

export function GoogleLoginButton({ next }: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // アプリ内ブラウザ (LINE / Instagram 等) からは Google OAuth が
  // 一律ブロックされる。その場合はサインインボタンではなく、
  // 外部ブラウザで開き直す導線を出す。
  const { inApp } = useInAppBrowser();

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
        // 個人情報最小化: profile スコープを意図的に外し、本名/写真/ロケールを取得しない。
        // email は Supabase Auth が一意キーとして扱うため残す。
        scopes: "openid email",
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // 成功時は Supabase が Google のページへ遷移させるので、ここから戻ることは無い
  };

  if (inApp) {
    // Chrome / 既定ブラウザへの導線は共通コンポーネントに集約してある
    // (ゲストの初回訪問時にも同じものを出すため)。
    return (
      <InAppBrowserNotice description="Google のセキュリティポリシーにより、アプリ内ブラウザからのサインインはブロックされます。下のボタンで開き直してください。" />
    );
  }

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

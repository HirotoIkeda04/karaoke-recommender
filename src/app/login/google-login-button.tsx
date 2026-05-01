"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  detectInAppBrowser,
  inAppBrowserLabel,
  type InAppBrowser,
} from "@/lib/in-app-browser";
import { createClient } from "@/lib/supabase/client";

interface GoogleLoginButtonProps {
  next: string;
}

export function GoogleLoginButton({ next }: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inAppKind, setInAppKind] = useState<InAppBrowser | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const info = detectInAppBrowser(navigator.userAgent);
    if (info.inApp) setInAppKind(info.kind);
  }, []);

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

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // noop
    }
  };

  if (inAppKind) {
    const label = inAppBrowserLabel(inAppKind);
    const isLine = inAppKind === "line";
    return (
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-semibold">
          {label} 内ブラウザでは Google ログインできません
        </p>
        <p className="text-xs leading-relaxed">
          Google のセキュリティポリシーにより、{label} 内ブラウザからのサインインはブロックされます。
          {isLine
            ? "右上の「⋯」メニューから「他のブラウザで開く」を選び、Safari / Chrome で開き直してください。"
            : "右上のメニューから「ブラウザで開く」を選び、Safari / Chrome で開き直してください。"}
        </p>
        <Button
          onClick={copyUrl}
          variant="outline"
          size="lg"
          className="w-full"
        >
          {copied ? "URL をコピーしました ✓" : "このページの URL をコピー"}
        </Button>
      </div>
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

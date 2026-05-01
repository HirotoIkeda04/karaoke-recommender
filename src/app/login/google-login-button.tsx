"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  buildChromeSchemeUrl,
  detectInAppBrowser,
  detectMobileOS,
  inAppBrowserLabel,
  type InAppBrowser,
  type MobileOS,
} from "@/lib/in-app-browser";
import { createClient } from "@/lib/supabase/client";

interface GoogleLoginButtonProps {
  next: string;
}

export function GoogleLoginButton({ next }: GoogleLoginButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inAppKind, setInAppKind] = useState<InAppBrowser | null>(null);
  const [os, setOs] = useState<MobileOS>("other");
  const [copied, setCopied] = useState(false);
  // Chrome 起動を試行したがアプリ切替が起きなかった (= Chrome 未インストール) と判定された状態
  const [chromeMissing, setChromeMissing] = useState(false);
  const chromeAttemptRef = useRef<number | null>(null);

  useEffect(() => {
    const info = detectInAppBrowser(navigator.userAgent);
    if (info.inApp) setInAppKind(info.kind);
    setOs(detectMobileOS(navigator.userAgent));
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

  // Chrome に直接遷移させる。Android では intent:// で Chrome 未インストール時も
  // S.browser_fallback_url が機能するため検知不要。iOS は googlechromes:// が
  // 失敗しても何も起きないだけなので、visibilitychange + timeout でフォールバック判定する。
  const openInChrome = () => {
    setChromeMissing(false);
    const schemeUrl = buildChromeSchemeUrl(window.location.href, os);
    if (!schemeUrl) return;

    if (os === "ios") {
      chromeAttemptRef.current = Date.now();
      const onVis = () => {
        if (document.hidden) {
          // アプリ切替が起きた = Chrome 起動成功とみなして以降の判定を止める
          chromeAttemptRef.current = null;
          document.removeEventListener("visibilitychange", onVis);
        }
      };
      document.addEventListener("visibilitychange", onVis);
      setTimeout(() => {
        document.removeEventListener("visibilitychange", onVis);
        // 試行から 1.5 秒経ってもページが見えたまま = Chrome 未起動 = 未インストール想定
        if (chromeAttemptRef.current !== null && !document.hidden) {
          setChromeMissing(true);
        }
        chromeAttemptRef.current = null;
      }, 1500);
    }

    window.location.href = schemeUrl;
  };

  if (inAppKind) {
    const label = inAppBrowserLabel(inAppKind);
    const isLine = inAppKind === "line";
    const canChromeButton = os === "ios" || os === "android";
    return (
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        <p className="font-semibold">
          {label} 内ブラウザでは Google ログインできません
        </p>
        <p className="text-xs leading-relaxed">
          Google のセキュリティポリシーにより、{label} 内ブラウザからのサインインはブロックされます。
        </p>

        {canChromeButton ? (
          <Button onClick={openInChrome} size="lg" className="w-full">
            Chrome で開く
          </Button>
        ) : null}

        {chromeMissing ? (
          <p className="text-xs leading-relaxed">
            Chrome がインストールされていないようです。お手数ですが
            {isLine
              ? "右上の「⋯」メニューから「他のブラウザで開く」を選んで Safari で開き直してください。"
              : "右上のメニューから「ブラウザで開く」を選び、Safari で開き直してください。"}
          </p>
        ) : (
          <p className="text-xs leading-relaxed">
            Chrome が無い場合は
            {isLine
              ? "右上の「⋯」メニューから「他のブラウザで開く」を選んで Safari で開いてください。"
              : "右上のメニューから「ブラウザで開く」を選んで Safari で開いてください。"}
          </p>
        )}

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

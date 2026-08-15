"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useInAppBrowser } from "@/hooks/use-in-app-browser";
import {
  buildChromeSchemeUrl,
  buildExternalBrowserUrl,
  inAppBrowserLabel,
} from "@/lib/in-app-browser";

/**
 * LINE / Instagram などのアプリ内ブラウザで開かれている時に、
 * Chrome か既定ブラウザ (iOS なら概ね Safari) へ移る導線を出す。
 *
 * Google OAuth は埋め込み WebView を一律ブロックする (disallowed_useragent /
 * Error 403) ので、ここを通らないとログイン自体ができない。
 *
 * iOS には Safari を名指しで開く URL scheme が存在しない。LINE だけは
 * openExternalBrowser=1 で既定ブラウザに移せるので、それを「Safari で開く」に
 * 充てている。それ以外は「⋯ メニューからブラウザで開く」を案内するしかない。
 */
export function InAppBrowserNotice({
  /** 見出しの下に出す補足。ログイン画面と初回訪問で文言を変えるため */
  description,
  className = "",
}: {
  description: string;
  className?: string;
}) {
  const { inApp, kind, os } = useInAppBrowser();
  const [copied, setCopied] = useState(false);
  // Chrome 起動を試したがアプリ切替が起きなかった (= 未インストール) 判定
  const [chromeMissing, setChromeMissing] = useState(false);
  const chromeAttemptRef = useRef<number | null>(null);

  if (!inApp) return null;

  const label = inAppBrowserLabel(kind);
  const canOpenChrome = os === "ios" || os === "android";
  const externalUrl =
    typeof window !== "undefined"
      ? buildExternalBrowserUrl(window.location.href, os, kind)
      : null;

  // Chrome に直接遷移させる。Android は intent:// が未インストール時も
  // S.browser_fallback_url で元に戻るので検知不要。iOS は googlechromes:// が
  // 失敗しても何も起きないだけなので、visibilitychange + timeout で判定する。
  const openInChrome = () => {
    setChromeMissing(false);
    const schemeUrl = buildChromeSchemeUrl(window.location.href, os);
    if (!schemeUrl) return;

    if (os === "ios") {
      chromeAttemptRef.current = Date.now();
      const onVis = () => {
        if (document.hidden) {
          // アプリ切替が起きた = Chrome 起動成功とみなして判定を止める
          chromeAttemptRef.current = null;
          document.removeEventListener("visibilitychange", onVis);
        }
      };
      document.addEventListener("visibilitychange", onVis);
      setTimeout(() => {
        document.removeEventListener("visibilitychange", onVis);
        if (chromeAttemptRef.current !== null && !document.hidden) {
          setChromeMissing(true);
        }
        chromeAttemptRef.current = null;
      }, 1500);
    }

    window.location.href = schemeUrl;
  };

  const openInDefaultBrowser = () => {
    if (!externalUrl) return;
    window.location.href = externalUrl;
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // クリップボードを使えない環境では黙って何もしない
    }
  };

  const manualHint =
    kind === "line"
      ? "右上の「⋯」メニューから「他のブラウザで開く」を選んでください。"
      : "右上のメニューから「ブラウザで開く」を選んでください。";

  return (
    <div
      className={`space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 ${className}`}
    >
      <p className="font-semibold">{label} 内ブラウザで開いています</p>
      <p className="text-xs leading-relaxed">{description}</p>

      <div className="space-y-2">
        {canOpenChrome ? (
          <Button onClick={openInChrome} size="lg" className="w-full">
            Chrome で開く
          </Button>
        ) : null}

        {externalUrl ? (
          <Button
            onClick={openInDefaultBrowser}
            variant="outline"
            size="lg"
            className="w-full"
          >
            {os === "ios" ? "Safari で開く" : "他のブラウザで開く"}
          </Button>
        ) : null}
      </div>

      {chromeMissing ? (
        <p className="text-xs leading-relaxed">
          Chrome がインストールされていないようです。お手数ですが{manualHint}
        </p>
      ) : externalUrl ? null : (
        <p className="text-xs leading-relaxed">
          Safari で開くには、{manualHint}
        </p>
      )}

      <Button onClick={copyUrl} variant="outline" size="lg" className="w-full">
        {copied ? "URL をコピーしました ✓" : "このページの URL をコピー"}
      </Button>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";

import { InAppBrowserNotice } from "@/components/in-app-browser-notice";
import { useIsGuest } from "@/components/session-provider";
import { useInAppBrowser } from "@/hooks/use-in-app-browser";

const DISMISS_KEY = "kyokumoku.in-app-browser-notice-dismissed";
const CHANGE_EVENT = "kyokumoku:in-app-notice-dismissed";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * まだ閉じられていないか。サーバーでは常に false。
 * useSyncExternalStore を使うのは、ハイドレーション後に一度だけ値が
 * 切り替わる形にして effect での setState を避けるため。
 */
function isNotDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(DISMISS_KEY) == null;
  } catch {
    // sessionStorage が使えない環境では毎回出す (出さないより害が小さい)
    return true;
  }
}

function neverOnServer() {
  return false;
}

/**
 * LINE などのアプリ内ブラウザで開かれたゲストに、最初に外部ブラウザへ
 * 移るよう促す。ここを通らないと Google ログインができない
 * (Google が埋め込み WebView を一律ブロックするため)。
 *
 * ただし移動を強制はしない。アプリ内ブラウザのままでもお試しの曲は評価
 * できるので、「このまま試す」で閉じられるようにしてある。
 */
export function InAppBrowserGate() {
  const isGuest = useIsGuest();
  const { inApp } = useInAppBrowser();
  const notDismissed = useSyncExternalStore(
    subscribe,
    isNotDismissed,
    neverOnServer,
  );

  if (!isGuest || !inApp || !notDismissed) return null;

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 保存できなくても閉じたことにする
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <div className="w-full max-w-sm space-y-3">
        <InAppBrowserNotice description="このままでも曲の評価はお試しいただけますが、Google ログインはアプリ内ブラウザからは行えません。ログインするには Chrome か Safari で開き直してください。" />
        <button
          type="button"
          onClick={dismiss}
          className="w-full rounded-full bg-white/90 px-4 py-2.5 text-sm font-medium text-zinc-800 backdrop-blur active:bg-white dark:bg-zinc-800/90 dark:text-zinc-100"
        >
          このまま試す
        </button>
      </div>
    </div>
  );
}

"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

function isIosInstallable() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (!/iPad|iPhone|iPod/.test(ua)) return false;
  // iOS 16.4+ は Safari 以外 (Chrome/Edge/Firefox 等) でも共有シートから追加できる。
  // 共有シートを持たない埋込ブラウザ (LINE/FB/Instagram 等) のみ除外する。
  if (/Line\/|FBAN|FBAV|Instagram|Twitter/i.test(ua)) return false;
  return true;
}

/**
 * PWA を未インストールの環境でのみ「ホーム画面に追加」ボタンをヘッダー右側に表示する。
 * - Android Chrome / デスクトップ Chromium 系: beforeinstallprompt を捕捉し、タップでネイティブの追加ダイアログを起動
 * - iOS (Safari/Chrome 等、埋込ブラウザ除く): beforeinstallprompt 非対応のため、タップで共有メニューからの追加手順を案内
 * - すでにインストール済み (display-mode: standalone, navigator.standalone): 非表示
 */
export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // すでに standalone モード (= ホーム画面起動 / インストール済み) なら非表示
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS PWA の独自プロパティ
      (window.navigator as Navigator & { standalone?: boolean })
        .standalone === true;
    if (isStandalone) {
      setInstalled(true);
      return;
    }

    if (isIosInstallable()) {
      setIos(true);
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed || (!deferredPrompt && !ios)) return null;

  const handleClick = async () => {
    if (ios && !deferredPrompt) {
      setShowIosGuide((v) => !v);
      return;
    }
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === "accepted") {
        setInstalled(true);
      }
    } catch (err) {
      console.error("Install prompt failed", err);
    } finally {
      // beforeinstallprompt は単発イベントのためクリア
      setDeferredPrompt(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="ml-auto rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
      >
        ホーム画面に追加
      </button>
      {showIosGuide && (
        <div
          role="dialog"
          aria-label="ホーム画面に追加の手順"
          className="absolute right-3 top-full z-20 mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-3 shadow-lg ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900 dark:ring-white/5"
        >
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              共有ボタン{" "}
              <Share className="inline-block size-3.5 -translate-y-px" /> から
              <span className="mx-0.5 font-medium text-zinc-900 dark:text-zinc-100">
                「ホーム画面に追加」
              </span>
              でアプリのように使えます。
            </p>
            <button
              type="button"
              onClick={() => setShowIosGuide(false)}
              aria-label="閉じる"
              className="-m-1 shrink-0 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

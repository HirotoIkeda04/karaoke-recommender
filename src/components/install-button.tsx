"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
};

/**
 * PWA を未インストールの環境でのみ「ホーム画面に追加」ボタンを表示する。
 * - Android Chrome / デスクトップ Chromium 系: beforeinstallprompt を捕捉して表示
 * - すでにインストール済み (display-mode: standalone, navigator.standalone): 非表示
 * - iOS Safari: beforeinstallprompt 非対応のため自動で非表示
 */
export function InstallButton() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

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

  if (installed || !deferredPrompt) return null;

  const handleClick = async () => {
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
    <button
      type="button"
      onClick={handleClick}
      className="ml-auto rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
    >
      ホーム画面に追加
    </button>
  );
}

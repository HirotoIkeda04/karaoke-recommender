"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type Platform = "android" | "ios" | null;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const STORAGE_KEY = "a2hs:status";
const SHOW_DELAY_MS = 4000;

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari: navigator.standalone は型に無いので any キャスト
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIosSafari() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  if (!isIos) return false;
  // 標準 Safari のみ対象 (CriOS=Chrome/EdgiOS=Edge/FxiOS=Firefox/LINE/FBAN 等の埋込ブラウザを除外)
  if (/CriOS|FxiOS|EdgiOS|OPiOS|Line\/|FBAN|FBAV|Instagram|Twitter/i.test(ua)) {
    return false;
  }
  return true;
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<Platform>(null);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (typeof localStorage === "undefined") return;
    if (localStorage.getItem(STORAGE_KEY)) return;

    let showTimer: ReturnType<typeof setTimeout> | undefined;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      const e = event as BeforeInstallPromptEvent;
      setDeferred(e);
      setPlatform("android");
      showTimer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    };
    const onInstalled = () => {
      try {
        localStorage.setItem(STORAGE_KEY, "installed");
      } catch {}
      setVisible(false);
      setPlatform(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    if (isIosSafari()) {
      setPlatform("ios");
      showTimer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (showTimer) clearTimeout(showTimer);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {}
    setVisible(false);
  };

  const handleAndroidInstall = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === "accepted") {
      try {
        localStorage.setItem(STORAGE_KEY, "installed");
      } catch {}
    } else {
      try {
        localStorage.setItem(STORAGE_KEY, "dismissed");
      } catch {}
    }
    setDeferred(null);
    setVisible(false);
  };

  if (!visible || !platform) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="a2hs-title"
      className="fixed inset-x-3 z-30 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg ring-1 ring-black/5 dark:border-zinc-800 dark:bg-zinc-900 dark:ring-white/5"
      style={{
        // BottomNav (~5rem) + safe-area の上に重ねる
        bottom: "calc(5rem + env(safe-area-inset-bottom) + 0.75rem)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-lg dark:bg-zinc-800">
          🎤
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="a2hs-title"
            className="text-sm font-semibold text-zinc-900 dark:text-zinc-50"
          >
            ホーム画面に追加
          </h2>
          {platform === "ios" ? (
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              Safari の共有ボタン{" "}
              <Share className="inline-block size-3.5 -translate-y-px" /> から
              <span className="mx-0.5 font-medium">「ホーム画面に追加」</span>
              でアプリのように使えます。
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              ホーム画面に追加するとアプリのように起動できます。
            </p>
          )}
          {platform === "android" && (
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={handleAndroidInstall}>
                追加する
              </Button>
              <Button size="sm" variant="ghost" onClick={dismiss}>
                あとで
              </Button>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="閉じる"
          className="-m-1 rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

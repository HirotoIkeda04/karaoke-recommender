"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { createInviteLink } from "@/app/(app)/friends/actions";

interface IssuedLink {
  url: string;
  expiresAt: string;
}

// プロフィール共有 (招待リンク + QR) モーダル付きボタン。
// クリック → モーダルを開く → 同時に招待リンクを発行 + QR を生成。
export function ShareProfileButton() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<IssuedLink | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // モーダルを開いた時にリンクが無ければ発行する
  useEffect(() => {
    if (!open || link || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createInviteLink();
      if (result.error || !result.path || !result.expiresAt) {
        setError(result.error ?? "リンク発行に失敗しました");
        return;
      }
      const fullUrl = `${window.location.origin}${result.path}?openExternalBrowser=1`;
      setLink({ url: fullUrl, expiresAt: result.expiresAt });
      try {
        const dataUrl = await QRCode.toDataURL(fullUrl, {
          margin: 1,
          width: 240,
          errorCorrectionLevel: "M",
        });
        setQrDataUrl(dataUrl);
      } catch {
        setError("QR コードの生成に失敗しました");
      }
    });
  }, [open, link, pending]);

  // ESC キーで閉じる
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("クリップボードにコピーできませんでした");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex-1 rounded-full border border-zinc-300 px-3 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        プロフィールをシェア
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
          role="dialog"
          aria-modal="true"
          aria-label="プロフィールをシェア"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                プロフィールをシェア
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                QR を読み取った相手とフレンドになります (7 日有効)
              </p>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className="flex size-60 items-center justify-center rounded-lg bg-white p-3">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt="プロフィール共有用 QR コード"
                    className="size-full"
                  />
                ) : (
                  <span className="text-sm text-zinc-500">
                    {pending ? "生成中..." : "..."}
                  </span>
                )}
              </div>

              {link ? (
                <div className="w-full space-y-2">
                  <div className="rounded-md border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-[11px] break-all text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
                    {link.url}
                  </div>
                  <Button
                    onClick={copy}
                    variant="outline"
                    size="sm"
                    className="w-full"
                  >
                    {copied ? "コピー済み ✓" : "リンクをコピー"}
                  </Button>
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                {error}
              </p>
            ) : null}

            <Button
              onClick={() => setOpen(false)}
              variant="ghost"
              size="sm"
              className="w-full"
            >
              閉じる
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}

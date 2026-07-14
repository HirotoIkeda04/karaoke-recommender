"use client";

import { ChevronLeft, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { useSongSheetClose } from "@/components/song-sheet-close-context";

interface BackButtonProps {
  /** 固定の戻り先を指定するモード。指定時は <Link> を出す */
  href?: string;
  /** href 未指定時、history が無い場合の遷移先 */
  fallbackHref?: string;
  label?: string;
  className?: string;
  /** ヒーロー画像など暗い背景の上に重ねる場合 */
  variant?: "default" | "overlay";
}

export function BackButton({
  href,
  fallbackHref = "/",
  label = "戻る",
  className,
  variant = "default",
}: BackButtonProps) {
  const router = useRouter();
  const closeSongSheet = useSongSheetClose();
  const Icon = closeSongSheet ? X : ChevronLeft;
  const accessibleLabel = closeSongSheet ? "楽曲詳細を閉じる" : label;

  const styles =
    variant === "overlay"
      ? "grid size-9 place-items-center rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
      : "-ml-2 grid size-9 place-items-center rounded-full text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800";

  if (href) {
    return (
      <Link
        href={href}
        aria-label={accessibleLabel}
        className={cn(
          styles,
          className,
          closeSongSheet && "right-0! left-auto!",
        )}
      >
        <Icon className="size-5" aria-hidden />
      </Link>
    );
  }

  // history が浅い (直接アクセス・共有リンク) 場合は fallbackHref に push
  const onClick = () => {
    if (closeSongSheet) {
      closeSongSheet();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 2) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      className={cn(
        styles,
        className,
        closeSongSheet && "right-0! left-auto!",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}

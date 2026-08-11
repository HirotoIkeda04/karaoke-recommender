"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { SongBottomSheet } from "@/components/song-bottom-sheet";

/**
 * 楽曲詳細のプレゼンテーション切替。
 * ホームのレコード下スワイプ経由 (?via=deck) はフル画面ページとして
 * スライドイン、それ以外 (検索やリンクからのタップ) は従来のボトムシート。
 *
 * 注意: window.location は使えない。Next (App Router) は router.push の
 * URL 反映を useInsertionEffect (コミット時) で行うため、遷移先コンポーネント
 * の初回 render 時点では旧 URL のままになる。useSearchParams は router の
 * state から新 URL を返すので、マウント初回 render でも正しく読める。
 * variant はマウント時に固定する (開いた後の URL 変化で表示形態は変えない)。
 */
export function SongSheetPresentation({
  children,
}: {
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const [variant] = useState<"sheet" | "page">(() =>
    searchParams.get("via") === "deck" ? "page" : "sheet",
  );
  return <SongBottomSheet variant={variant}>{children}</SongBottomSheet>;
}

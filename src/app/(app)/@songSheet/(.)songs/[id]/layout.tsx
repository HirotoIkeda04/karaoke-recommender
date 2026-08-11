import { Suspense } from "react";

import { SongSheetPresentation } from "@/components/song-sheet-presentation";

export default function SongSheetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Suspense は useSearchParams のビルド時制約 (missing-suspense) 対策。
  // クライアント遷移でしか描画されないためフォールバックは実質出ない。
  return (
    <Suspense fallback={null}>
      <SongSheetPresentation>{children}</SongSheetPresentation>
    </Suspense>
  );
}

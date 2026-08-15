"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * ホームのレコードデッキが「擬似的な楽曲詳細」を開いているかを
 * (app) レイアウト全体へ配る。
 *
 * デッキ (children の中) とボトムナビ (レイアウト直下) は兄弟なので、
 * デッキのローカル state では届かない。詳細表示の間はナビを引っ込めたいので、
 * 楽曲シート (route ベースで判定できる) と違ってこの状態だけは共有する。
 */
const DeckDetailContext = createContext<{
  detailOpen: boolean;
  setDetailOpen: (open: boolean) => void;
}>({ detailOpen: false, setDetailOpen: () => {} });

export function DeckDetailProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [detailOpen, setDetailOpen] = useState(false);
  // children はレイアウトから来る同一の要素なので、value さえ安定させれば
  // 開閉のたびに再レンダーされるのは実際に購読している側だけになる。
  const value = useMemo(() => ({ detailOpen, setDetailOpen }), [detailOpen]);
  return (
    <DeckDetailContext.Provider value={value}>
      {children}
    </DeckDetailContext.Provider>
  );
}

export function useDeckDetail() {
  return useContext(DeckDetailContext);
}

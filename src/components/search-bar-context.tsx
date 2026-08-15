"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * 検索タブの入力欄は、ページ (LiveSearch) ではなく画面下部のバー
 * (AppBottomNav → AppSearchBar) に置いている。App Store と同じく
 * 「検索タブではタブバーが検索欄に化ける」構造にするためで、そうすると
 * 入力欄と、その結果を描くコンポーネントが別のツリーに分かれる。
 * 両者をつなぐのがこの context。
 *
 * 持たせるのは「入力値」と「検索モードに入っているか」の 2 つだけ。
 * 検索結果・履歴・おすすめは LiveSearch のローカル状態のままにして、
 * レイアウトのために状態を持ち上げる範囲を最小にする。
 */
interface SearchBarValue {
  query: string;
  setQuery: (q: string) => void;
  /**
   * 検索モードに入っているか。入力欄にフォーカスした時点で true になり、
   * フォーカスが外れても降りない (結果を見ながらスクロールできる)。
   * バーの形 (先頭の丸ボタン / 末尾の × ボタン) と、ページ側の
   * 閲覧グリッド / 検索 UI の出し分けは、どちらもこれ 1 つで決まる。
   * blur ではなく open で切り替えるのは、スクロールでキーボードが
   * 閉じるたびにバーの形が入れ替わるのを避けるため。
   */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** × 押下、および検索タブを離れたとき。入力を消して閲覧モードへ戻す。 */
  reset: () => void;
}

const SearchBarContext = createContext<SearchBarValue | null>(null);

export function SearchBarProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const reset = useCallback(() => {
    setQuery("");
    setOpen(false);
  }, []);

  const value = useMemo(
    () => ({ query, setQuery, open, setOpen, reset }),
    [query, open, reset],
  );

  return (
    <SearchBarContext.Provider value={value}>
      {children}
    </SearchBarContext.Provider>
  );
}

export function useSearchBar(): SearchBarValue {
  const value = useContext(SearchBarContext);
  if (!value) {
    throw new Error("useSearchBar は SearchBarProvider の内側で使うこと");
  }
  return value;
}

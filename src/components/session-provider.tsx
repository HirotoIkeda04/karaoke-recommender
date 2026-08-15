"use client";

import { createContext, useContext } from "react";

/**
 * 「今このページはゲスト (未ログイン) か」をクライアント全体へ配る。
 *
 * (app)/layout.tsx がサーバー側のセッション有無をそのまま渡す。ページごとに
 * getUser を呼び直さずに済ませるためと、評価の保存先 (DB か localStorage か)
 * を 1 か所で決めるための土台。
 */
const GuestContext = createContext(false);

export function SessionProvider({
  isGuest,
  children,
}: {
  isGuest: boolean;
  children: React.ReactNode;
}) {
  return (
    <GuestContext.Provider value={isGuest}>{children}</GuestContext.Provider>
  );
}

/** 未ログインなら true */
export function useIsGuest(): boolean {
  return useContext(GuestContext);
}

"use client";

import { createContext, useContext } from "react";

const SongSheetCloseContext = createContext<(() => void) | null>(null);

export function useSongSheetClose() {
  return useContext(SongSheetCloseContext);
}

export function SongSheetCloseProvider({
  children,
  close,
}: {
  children: React.ReactNode;
  close: () => void;
}) {
  return (
    <SongSheetCloseContext.Provider value={close}>
      {children}
    </SongSheetCloseContext.Provider>
  );
}

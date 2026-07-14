"use client";

import { createContext, useContext } from "react";

const SongSheetScrollContext = createContext(0);

export function useSongSheetScrolled() {
  return useContext(SongSheetScrollContext);
}

export function SongSheetScrollProvider({
  children,
  scrollProgress,
}: {
  children: React.ReactNode;
  scrollProgress: number;
}) {
  return (
    <SongSheetScrollContext.Provider value={scrollProgress}>
      {children}
    </SongSheetScrollContext.Provider>
  );
}

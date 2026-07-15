"use client";

import Link from "next/link";

import { useSongSheetScrolled } from "./song-sheet-scroll-context";

interface SongFloatingHeaderProps {
  title: string;
  artist: string;
  artistId: string | null;
  releaseYear: number | null;
  image: string | null;
}

export function SongFloatingHeader({
  title,
  artist,
  artistId,
  releaseYear,
  image,
}: SongFloatingHeaderProps) {
  const scrollProgress = useSongSheetScrolled();

  return (
    <div
      aria-hidden={scrollProgress === 0}
      className="pointer-events-none fixed inset-x-0 top-[10dvh] z-30 mx-auto max-w-xl overflow-hidden rounded-t-3xl border-b border-white/10 bg-background pb-4 pt-2 shadow-lg"
      style={{
        opacity: scrollProgress,
        pointerEvents: scrollProgress > 0.1 ? "auto" : "none",
      }}
    >
      {image ? (
        <div
          aria-hidden
          className="absolute inset-0 z-0 scale-125 bg-cover bg-center"
          style={{
            backgroundImage: `url(${image})`,
            filter: "blur(24px) saturate(1.3)",
          }}
        />
      ) : null}
      <div className="relative z-10 mx-auto max-w-md px-4">
        <p className="truncate text-base font-semibold text-white">
          {title}
        </p>
        <p className="truncate text-xs text-white/80">
          {artistId ? (
            <Link href={`/artists/${artistId}`} className="underline-offset-2 hover:underline">
              {artist}
            </Link>
          ) : (
            artist
          )}
          {releaseYear ? ` · ${releaseYear}` : ""}
        </p>
      </div>
    </div>
  );
}

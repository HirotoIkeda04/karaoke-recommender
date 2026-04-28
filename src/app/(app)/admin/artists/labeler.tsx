"use client";

import { useState, useTransition } from "react";

import { GENRE_LABELS, type GenreCode } from "@/lib/genres";

import { updateArtistGenres } from "./actions";

export interface ArtistRow {
  id: string;
  name: string;
  genres: GenreCode[];
  songCount: number;
}

export function ArtistLabeler({
  artists,
  genreCodes,
}: {
  artists: ArtistRow[];
  genreCodes: readonly GenreCode[];
}) {
  if (artists.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-input p-8 text-center text-sm text-muted-foreground">
        該当するアーティストがありません
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {artists.map((a) => (
        <ArtistRowItem key={a.id} artist={a} genreCodes={genreCodes} />
      ))}
    </ul>
  );
}

function ArtistRowItem({
  artist,
  genreCodes,
}: {
  artist: ArtistRow;
  genreCodes: readonly GenreCode[];
}) {
  const [genres, setGenres] = useState<GenreCode[]>(artist.genres);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const toggle = (code: GenreCode) => {
    const next = genres.includes(code)
      ? genres.filter((g) => g !== code)
      : [...genres, code];
    const prev = genres;
    setGenres(next);
    setError(null);

    startTransition(async () => {
      const result = await updateArtistGenres(artist.id, next);
      if (result.error) {
        setError(result.error);
        setGenres(prev); // revert
      }
    });
  };

  return (
    <li
      className={`rounded-lg border border-input bg-card p-3 transition ${
        isPending ? "opacity-70" : ""
      }`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-baseline gap-2">
          <span className="font-medium">{artist.name}</span>
          <span className="text-xs text-muted-foreground">
            {artist.songCount} 曲
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {genreCodes.map((code) => {
            const selected = genres.includes(code);
            return (
              <button
                key={code}
                type="button"
                onClick={() => toggle(code)}
                disabled={isPending}
                className={`rounded-full px-2.5 py-1 text-xs transition ${
                  selected
                    ? "bg-foreground text-background"
                    : "bg-muted text-foreground hover:bg-muted/70"
                } disabled:cursor-not-allowed`}
              >
                {GENRE_LABELS[code]}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-500">保存失敗: {error}</p>
      )}
    </li>
  );
}

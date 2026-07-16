import {
  rankGenreSongs,
  type GenreRankingCandidate,
} from "./genre-ranking";
import type { GenreCode } from "./genres";

export interface GenreReleaseYearCandidate extends GenreRankingCandidate {
  genres: string[] | null;
  original_release_year: number | null;
  original_release_year_check_status: string | null;
}

export interface GenreReleaseYearTargetPlan<
  T extends GenreReleaseYearCandidate,
> {
  rankings: Map<GenreCode, T[]>;
  queue: T[];
}

export function buildGenreReleaseYearTargetPlan<
  T extends GenreReleaseYearCandidate,
>(
  songs: T[],
  artistGenres: Map<string, string[]>,
  genreCodes: readonly GenreCode[],
  perGenreLimit: number,
  currentYear: number,
): GenreReleaseYearTargetPlan<T> {
  const rankings = new Map<GenreCode, T[]>();

  for (const code of genreCodes) {
    const candidates = songs.filter((song) => {
      if (song.genres?.includes(code)) return true;
      if (!song.artist_id) return false;
      return artistGenres.get(song.artist_id)?.includes(code) ?? false;
    });
    rankings.set(
      code,
      rankGenreSongs(candidates, currentYear).slice(0, perGenreLimit),
    );
  }

  // ジャンルごとの順位を一段ずつ取り、一部ジャンルだけで
  // 先頭バッチを使い切らないキューにする。複数ジャンル所属曲は id で去重複。
  const queue: T[] = [];
  const seen = new Set<string>();
  for (let rank = 0; rank < perGenreLimit; rank++) {
    for (const code of genreCodes) {
      const song = rankings.get(code)?.[rank];
      if (!song || seen.has(song.id)) continue;
      seen.add(song.id);
      queue.push(song);
    }
  }

  return { rankings, queue };
}

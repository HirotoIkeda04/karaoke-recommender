import assert from "node:assert/strict";
import test from "node:test";

import {
  genreRankingScore,
  rankGenreSongs,
  type GenreRankingCandidate,
} from "./genre-ranking";

function song(
  id: string,
  artist: string,
  karaokeScore: number,
  overrides: Partial<GenreRankingCandidate> = {},
): GenreRankingCandidate {
  return {
    id,
    title: id,
    artist,
    artist_id: `artist-${artist}`,
    karaoke_score: karaokeScore,
    fame_score: null,
    cert_score: null,
    release_year: 2020,
    original_release_year: null,
    dam_request_no: "1234-56",
    spotify_track_id: `spotify-${id}`,
    range_low_midi: 55,
    range_high_midi: 74,
    ...overrides,
  };
}

test("裏付けのある近年曲を欠損の多い予測値だけの曲より上位にする", () => {
  const currentHit = song("current-hit", "CURRENT", 0.065, {
    release_year: 2024,
  });
  const unverifiedPrediction = song("prediction", "LEGACY", 0.18, {
    release_year: 2023,
    dam_request_no: null,
    spotify_track_id: null,
    range_low_midi: null,
    range_high_midi: null,
  });

  assert.ok(
    genreRankingScore(currentHit, 2026) >
      genreRankingScore(unverifiedPrediction, 2026),
  );
});

test("再発年ではなく原発売年を新しさの計算に使う", () => {
  const reissuedOldSong = song("reissued", "LEGACY", 0.2, {
    release_year: 2025,
    original_release_year: 2001,
  });
  const actualRecentSong = song("recent", "CURRENT", 0.2, {
    release_year: 2023,
    original_release_year: 2023,
  });

  assert.ok(
    genreRankingScore(actualRecentSong, 2026) >
      genreRankingScore(reissuedOldSong, 2026),
  );
});

test("上位20曲は十分な候補があれば1アーティスト2曲までにする", () => {
  const candidates = Array.from({ length: 15 }, (_, artistIndex) => [
    song(`a-${artistIndex}`, `artist-${artistIndex}`, 1 - artistIndex / 100),
    song(`b-${artistIndex}`, `artist-${artistIndex}`, 0.9 - artistIndex / 100),
    song(`c-${artistIndex}`, `artist-${artistIndex}`, 0.8 - artistIndex / 100),
  ]).flat();

  const ranked = rankGenreSongs(candidates, 2026);
  const counts = new Map<string, number>();
  for (const item of ranked.slice(0, 20)) {
    counts.set(item.artist, (counts.get(item.artist) ?? 0) + 1);
  }

  assert.ok(Math.max(...counts.values()) <= 2);
});

test("上位50曲は十分な候補があれば1アーティスト4曲までにする", () => {
  const candidates = Array.from({ length: 15 }, (_, artistIndex) => [
    song(`a-${artistIndex}`, `artist-${artistIndex}`, 1 - artistIndex / 100),
    song(`b-${artistIndex}`, `artist-${artistIndex}`, 0.9 - artistIndex / 100),
    song(`c-${artistIndex}`, `artist-${artistIndex}`, 0.8 - artistIndex / 100),
    song(`d-${artistIndex}`, `artist-${artistIndex}`, 0.7 - artistIndex / 100),
    song(`e-${artistIndex}`, `artist-${artistIndex}`, 0.6 - artistIndex / 100),
  ]).flat();

  const ranked = rankGenreSongs(candidates, 2026);
  const counts = new Map<string, number>();
  for (const item of ranked.slice(0, 50)) {
    counts.set(item.artist, (counts.get(item.artist) ?? 0) + 1);
  }

  assert.ok(Math.max(...counts.values()) <= 4);
  assert.deepEqual(
    new Set(ranked.map((item) => item.id)),
    new Set(candidates.map((item) => item.id)),
  );
});

test("アーティスト数が少ない場合は上限を緩和して全曲を残す", () => {
  const candidates = Array.from({ length: 60 }, (_, index) =>
    song(`song-${index}`, `artist-${index % 3}`, 1 - index / 100),
  );

  const ranked = rankGenreSongs(candidates, 2026);
  assert.equal(ranked.length, candidates.length);
  assert.equal(new Set(ranked.map((item) => item.id)).size, candidates.length);
});

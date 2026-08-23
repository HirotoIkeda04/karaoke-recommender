import assert from "node:assert/strict";
import test from "node:test";

import type { GenreRankingCandidate } from "./genre-ranking";
import {
  buildGenreReleaseYearTargetPlan,
  type GenreReleaseYearCandidate,
} from "./genre-release-year-targets";

function song(
  id: string,
  artistId: string,
  genres: string[],
  score: number,
): GenreReleaseYearCandidate {
  return {
    id,
    title: id,
    artist: artistId,
    artist_id: artistId,
    karaoke_score: score,
    fame_score: null,
    cert_score: null,
    release_year: 2024,
    dam_request_no: "1234-56",
    spotify_track_id: id,
    range_low_midi: 55,
    range_high_midi: 74,
    genres,
    original_release_year: null,
    original_release_year_check_status: null,
  } satisfies GenreRankingCandidate & GenreReleaseYearCandidate;
}

test("各ジャンルの同じ順位を順番に取り、複数所属曲は去重複する", () => {
  const songs = [
    song("shared", "shared-artist", ["j_pop", "idol_female"], 1),
    song("j-pop-2", "j-pop-artist", ["j_pop"], 0.9),
    song("idol-2", "idol-artist", ["idol_female"], 0.8),
  ];

  const plan = buildGenreReleaseYearTargetPlan(
    songs,
    new Map(),
    ["j_pop", "idol_female"],
    2,
    2026,
  );

  assert.deepEqual(
    plan.queue.map((item) => item.id),
    ["shared", "j-pop-2", "idol-2"],
  );
  assert.equal(new Set(plan.queue.map((item) => item.id)).size, 3);
});

test("楽曲直接タグがなくてもアーティストのジャンルを使う", () => {
  const target = song("artist-tag", "artist-1", [], 1);
  const plan = buildGenreReleaseYearTargetPlan(
    [target],
    new Map([["artist-1", ["idol_female"]]]),
    ["idol_female"],
    100,
    2026,
  );

  assert.deepEqual(plan.queue.map((item) => item.id), ["artist-tag"]);
});

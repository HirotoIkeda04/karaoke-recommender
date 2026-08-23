import assert from "node:assert/strict";
import test from "node:test";

import { buildGuestLibrary, percentileCont } from "./guest-library";
import type { GuestRatingMap } from "./guest-ratings";
import type { GuestSongRecord } from "./guest-songs";

// percentile_cont は PostgreSQL 側の定義が正。ここがずれると、同じ評価でも
// ログイン前と後で推定音域が変わってしまう。
test("percentileCont は PostgreSQL の percentile_cont と同じ補間をする", () => {
  // select percentile_cont(0.75) within group (order by v)
  //   from (values (60),(64),(67),(72)) t(v);  -> 68.25
  assert.equal(percentileCont([60, 64, 67, 72], 0.75), 68.25);
  // select percentile_cont(0.25) ... -> 63.0
  assert.equal(percentileCont([60, 64, 67, 72], 0.25), 63);
  // 要素が 1 つならその値、0 なら null
  assert.equal(percentileCont([65], 0.75), 65);
  assert.equal(percentileCont([], 0.75), null);
  // 中央値は隣り合う 2 値の平均
  assert.equal(percentileCont([60, 70], 0.5), 65);
});

function song(
  id: string,
  overrides: Partial<GuestSongRecord> = {},
): GuestSongRecord {
  return {
    id,
    title: `曲${id}`,
    artist: "テスト",
    artist_id: null,
    release_year: 2020,
    original_release_year: null,
    genres: null,
    range_low_midi: 50,
    range_high_midi: 70,
    falsetto_max_midi: null,
    image_url_small: null,
    image_url_medium: null,
    image_url_large: null,
    itunes_preview_url: null,
    itunes_track_id: null,
    spotify_track_id: null,
    duration_ms: null,
    fame_score: null,
    cert_score: null,
    karaoke_score: null,
    effective_genres: ["j_pop"],
    ...overrides,
  };
}

const at = (iso: string) => ({ updatedAt: iso });

test("skip は一覧にも年代分布にも出さない", () => {
  const ratings: GuestRatingMap = {
    a: { rating: "easy", ...at("2026-08-01T00:00:00.000Z") },
    b: { rating: "skip", ...at("2026-08-02T00:00:00.000Z") },
  };
  const library = buildGuestLibrary(ratings, [song("a"), song("b")]);

  assert.equal(library.ratedSongCount, 1);
  assert.equal(library.evaluationsByRating.easy.length, 1);
  assert.deepEqual(library.eraBuckets, { 2020: 1 });
});

test("ジャンル分布は苦手を除く (user_genre_distribution と同じ)", () => {
  const ratings: GuestRatingMap = {
    a: { rating: "easy", ...at("2026-08-01T00:00:00.000Z") },
    b: { rating: "practicing", ...at("2026-08-02T00:00:00.000Z") },
    c: { rating: "medium", ...at("2026-08-03T00:00:00.000Z") },
    d: { rating: "hard", ...at("2026-08-04T00:00:00.000Z") },
  };
  const songs = ["a", "b", "c", "d"].map((id) => song(id));
  const library = buildGuestLibrary(ratings, songs);

  // 苦手の 1 曲だけ数えない
  assert.deepEqual(library.genreBuckets, { j_pop: 3 });
  // 年代分布は 4 段階すべて数える
  assert.deepEqual(library.eraBuckets, { 2020: 4 });
});

test("推定音域は得意評価だけから出す", () => {
  const ratings: GuestRatingMap = {
    a: { rating: "easy", ...at("2026-08-01T00:00:00.000Z") },
    b: { rating: "easy", ...at("2026-08-02T00:00:00.000Z") },
    c: { rating: "hard", ...at("2026-08-03T00:00:00.000Z") },
  };
  const songs = [
    song("a", { range_low_midi: 48, range_high_midi: 70, falsetto_max_midi: 80 }),
    song("b", { range_low_midi: 52, range_high_midi: 74 }),
    // 苦手なので推定に混ぜない (混ざると上限が 90 に跳ね上がる)
    song("c", { range_low_midi: 40, range_high_midi: 90, falsetto_max_midi: 95 }),
  ];
  const { voiceEstimate } = buildGuestLibrary(ratings, songs);

  assert.equal(voiceEstimate.easy_count, 2);
  assert.equal(voiceEstimate.comfortable_max_midi, 73); // 70,74 の 75%
  assert.equal(voiceEstimate.comfortable_min_midi, 49); // 48,52 の 25%
  assert.equal(voiceEstimate.falsetto_max_midi, 80);
});

test("公開曲から外れた古い評価は無視する", () => {
  const ratings: GuestRatingMap = {
    gone: { rating: "easy", ...at("2026-08-01T00:00:00.000Z") },
  };
  const library = buildGuestLibrary(ratings, [song("a")]);
  assert.equal(library.ratedSongCount, 0);
});

test("一覧は評価日の新しい順に並べる", () => {
  const ratings: GuestRatingMap = {
    old: { rating: "easy", ...at("2026-08-01T00:00:00.000Z") },
    new: { rating: "easy", ...at("2026-08-05T00:00:00.000Z") },
  };
  const library = buildGuestLibrary(ratings, [song("old"), song("new")]);
  assert.deepEqual(
    library.evaluationsByRating.easy.map((row) => row.song.id),
    ["new", "old"],
  );
});

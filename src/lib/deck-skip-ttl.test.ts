import assert from "node:assert/strict";
import test from "node:test";

import { SKIP_TTL_MS, isExcludedFromDeck } from "./deck";

// 基準時刻 (固定)。実時刻に依存させない。
const NOW = Date.parse("2026-08-15T00:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

test("skip 以外の評価は経過時間に関わらず永久に除外する", () => {
  for (const rating of ["easy", "medium", "hard", "practicing"]) {
    assert.equal(
      isExcludedFromDeck({ rating, updated_at: ago(365 * DAY) }, NOW),
      true,
      `${rating} は 1 年経っても除外されるべき`,
    );
  }
});

test("20 日以内の skip は除外する", () => {
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: ago(0) }, NOW),
    true,
  );
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: ago(19 * DAY) }, NOW),
    true,
  );
});

test("20 日を過ぎた skip は候補に戻す", () => {
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: ago(21 * DAY) }, NOW),
    false,
  );
  // 実際に不具合を起こした値域 (75〜103 日前の skip が全部落ちていた)
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: ago(103 * DAY) }, NOW),
    false,
  );
});

test("境界はちょうど 20 日", () => {
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: ago(SKIP_TTL_MS) }, NOW),
    true,
    "ちょうど 20 日は RPC の >= と同じくまだ除外",
  );
  assert.equal(
    isExcludedFromDeck(
      { rating: "skip", updated_at: ago(SKIP_TTL_MS + 1) },
      NOW,
    ),
    false,
  );
});

test("タイムゾーン表記が +00:00 でも Z と同じ判定になる", () => {
  const plusOffset = new Date(NOW - 21 * DAY)
    .toISOString()
    .replace("Z", "+00:00");
  assert.equal(
    isExcludedFromDeck({ rating: "skip", updated_at: plusOffset }, NOW),
    false,
  );
});

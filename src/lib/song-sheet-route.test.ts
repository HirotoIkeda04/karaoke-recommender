import assert from "node:assert/strict";
import test from "node:test";

import { isSongSheetOpen } from "./song-sheet-route";

test("検索トップではBottomNaviを隠さない", () => {
  assert.equal(isSongSheetOpen("/songs", "songs"), false);
});

test("曲詳細の並列ルートを開いた時だけBottomNaviを隠す", () => {
  assert.equal(isSongSheetOpen("/songs/song-id", "songs"), true);
});

test("通常の曲詳細ページやジャンルページではBottomNaviを隠さない", () => {
  assert.equal(isSongSheetOpen("/songs/song-id", "songs/song-id"), false);
  assert.equal(isSongSheetOpen("/songs/genre/j_rock", "songs"), false);
});

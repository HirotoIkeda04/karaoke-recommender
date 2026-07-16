import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseTrustedOriginalReleaseMatch,
  selectOriginalReleaseMatch,
  selectWikidataOriginalReleaseMatch,
  type MusicBrainzRecording,
} from "./original-release-year";

function recording(
  id: string,
  date: string,
  overrides: Partial<MusicBrainzRecording> = {},
): MusicBrainzRecording {
  return {
    id,
    score: 100,
    title: "世界が終るまでは…",
    "first-release-date": date,
    "artist-credit": [{ name: "WANDS", artist: { name: "WANDS" } }],
    ...overrides,
  };
}

test("同じ曲名と歌手の候補群から最古の発売日を選ぶ", () => {
  const match = selectOriginalReleaseMatch(
    {
      title: "世界が終るまでは...",
      artist: "WANDS",
      release_year: 2023,
    },
    [
      recording("reissue", "2014-12-17"),
      recording("original", "1994-06-08"),
      recording("album", "2000-06-09"),
    ],
  );

  assert.equal(match?.year, 1994);
  assert.equal(match?.recordingId, "original");
});

test("歌手が異なる同名曲は採用しない", () => {
  const match = selectOriginalReleaseMatch(
    { title: "世界が終るまでは…", artist: "WANDS", release_year: 2023 },
    [
      recording("cover", "1993-01-01", {
        "artist-credit": [{ name: "OTHER", artist: { name: "OTHER" } }],
      }),
    ],
  );

  assert.equal(match, null);
});

test("現行メタデータより新しい候補は自動確定しない", () => {
  const match = selectOriginalReleaseMatch(
    { title: "世界が終るまでは…", artist: "WANDS", release_year: 1994 },
    [recording("later", "1995-01-01")],
  );

  assert.equal(match, null);
});

test("MusicBrainzの信頼度が低い候補は採用しない", () => {
  const match = selectOriginalReleaseMatch(
    { title: "世界が終るまでは…", artist: "WANDS", release_year: 2023 },
    [recording("weak", "1994-06-08", { score: 89 })],
  );

  assert.equal(match, null);
});

test("Wikidataは曲名・歌手名が一致する公表日だけを選ぶ", () => {
  const match = selectWikidataOriginalReleaseMatch(
    { title: "北国の春", artist: "千昌夫", release_year: 2008 },
    [
      {
        itemId: "Q3847120",
        title: "北国の春",
        performer: "千昌夫",
        date: "1977-04-05T00:00:00Z",
      },
      {
        itemId: "wrong-artist",
        title: "北国の春",
        performer: "別の歌手",
        date: "1976-01-01T00:00:00Z",
      },
    ],
  );

  assert.equal(match?.year, 1977);
  assert.equal(match?.itemId, "Q3847120");
});

test("大幅な年代補正はWikidataとMusicBrainzの一致時だけ採用する", () => {
  const song = {
    title: "世界が終るまでは…",
    artist: "WANDS",
    release_year: 2023,
  };
  const wikidata = selectWikidataOriginalReleaseMatch(song, [
    {
      itemId: "Q11362123",
      title: "世界が終るまでは…",
      performer: "WANDS",
      date: "1994-06-08T00:00:00Z",
    },
  ]);
  const musicBrainz = selectOriginalReleaseMatch(song, [
    recording("mb-original", "1994-06-08"),
  ]);

  assert.deepEqual(
    chooseTrustedOriginalReleaseMatch(song, wikidata, musicBrainz),
    {
      status: "matched",
      match: {
        year: 1994,
        source: "wikidata+musicbrainz",
        sourceId: "wikidata:Q11362123;musicbrainz:mb-original",
      },
    },
  );
});

test("大幅補正で二つの出典年が食い違う場合は更新しない", () => {
  const song = { title: "北国の春", artist: "千昌夫", release_year: 2008 };
  const wikidata = selectWikidataOriginalReleaseMatch(song, [
    {
      itemId: "Q3847120",
      title: "北国の春",
      performer: "千昌夫",
      date: "1977-04-05T00:00:00Z",
    },
  ]);
  const musicBrainz = selectOriginalReleaseMatch(song, [
    recording("mb-re-recording", "1993-01-01", {
      title: "北国の春",
      "artist-credit": [
        { name: "千昌夫", artist: { name: "千昌夫" } },
      ],
    }),
  ]);

  assert.deepEqual(
    chooseTrustedOriginalReleaseMatch(song, wikidata, musicBrainz),
    { status: "conflict", wikidataYear: 1977, musicBrainzYear: 1993 },
  );
});

test("単一出典の5年以内の補正は採用し、大幅補正は保留する", () => {
  const nearSong = { title: "粉雪", artist: "レミオロメン", release_year: 2006 };
  const nearMatch = selectOriginalReleaseMatch(nearSong, [
    recording("near", "2005-01-01", {
      title: "粉雪",
      "artist-credit": [
        {
          name: "レミオロメン",
          artist: { name: "レミオロメン" },
        },
      ],
    }),
  ]);
  assert.equal(
    chooseTrustedOriginalReleaseMatch(nearSong, null, nearMatch).status,
    "matched",
  );

  const oldSong = {
    title: "世界が終るまでは…",
    artist: "WANDS",
    release_year: 2023,
  };
  const oldMatch = selectOriginalReleaseMatch(oldSong, [
    recording("old", "1994-06-08"),
  ]);
  assert.deepEqual(chooseTrustedOriginalReleaseMatch(oldSong, null, oldMatch), {
    status: "unmatched",
    reason: "large_single_source_correction",
  });
});

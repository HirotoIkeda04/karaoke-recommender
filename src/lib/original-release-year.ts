export interface OriginalReleaseSong {
  title: string;
  artist: string;
  release_year: number | null;
}

export interface MusicBrainzArtistCredit {
  name: string;
  joinphrase?: string;
  artist?: { name?: string };
}

export interface MusicBrainzRecording {
  id: string;
  score?: number;
  title: string;
  "first-release-date"?: string;
  "artist-credit"?: MusicBrainzArtistCredit[];
}

export interface OriginalReleaseMatch {
  year: number;
  date: string;
  recordingId: string;
  recordingTitle: string;
  recordingArtist: string;
  musicBrainzScore: number;
}

export interface WikidataReleaseCandidate {
  itemId: string;
  title: string;
  performer: string;
  date: string;
}

export interface WikidataOriginalReleaseMatch {
  year: number;
  date: string;
  itemId: string;
  title: string;
  performer: string;
}

export interface TrustedOriginalReleaseMatch {
  year: number;
  source: "musicbrainz" | "wikidata" | "wikidata+musicbrainz";
  sourceId: string;
}

export type TrustedOriginalReleaseDecision =
  | { status: "matched"; match: TrustedOriginalReleaseMatch }
  | {
      status: "conflict";
      wikidataYear: number;
      musicBrainzYear: number;
    }
  | { status: "unmatched"; reason: string };

const MIN_MUSICBRAINZ_SCORE = 90;

/**
 * 自動更新で別曲を採用しないことを優先し、記号と空白だけを吸収する。
 * 括弧内のバージョン名は残し、原曲と再録版を混同しない。
 */
export function normalizeReleaseMatchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .replace(/[\p{P}\p{S}\s]+/gu, "");
}

function recordingArtistNames(recording: MusicBrainzRecording) {
  const credits = recording["artist-credit"] ?? [];
  const joined = credits
    .map((credit) => `${credit.name}${credit.joinphrase ?? ""}`)
    .join("");

  return [
    joined,
    ...credits.flatMap((credit) => [credit.name, credit.artist?.name ?? ""]),
  ].filter(Boolean);
}

function parseReleaseDate(value: string | undefined) {
  if (!value || !/^\d{4}(?:-\d{2})?(?:-\d{2})?$/.test(value)) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  return { date: value, year };
}

export function selectWikidataOriginalReleaseMatch(
  song: OriginalReleaseSong,
  candidates: WikidataReleaseCandidate[],
): WikidataOriginalReleaseMatch | null {
  const title = normalizeReleaseMatchText(song.title);
  const artist = normalizeReleaseMatchText(song.artist);

  const matches = candidates.flatMap((candidate) => {
    const release = parseReleaseDate(candidate.date.slice(0, 10));
    if (!release) return [];
    if (normalizeReleaseMatchText(candidate.title) !== title) return [];
    if (normalizeReleaseMatchText(candidate.performer) !== artist) return [];
    if (song.release_year != null && release.year > song.release_year) return [];

    return [
      {
        year: release.year,
        date: candidate.date,
        itemId: candidate.itemId,
        title: candidate.title,
        performer: candidate.performer,
      } satisfies WikidataOriginalReleaseMatch,
    ];
  });

  matches.sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.itemId.localeCompare(b.itemId),
  );
  return matches[0] ?? null;
}

/**
 * 現行値から5年を超える大幅補正は、一つの外部DBだけでは確定しない。
 * Wikidata と MusicBrainz が同じ年を返した場合だけ大幅補正を許可する。
 */
export function chooseTrustedOriginalReleaseMatch(
  song: OriginalReleaseSong,
  wikidata: WikidataOriginalReleaseMatch | null,
  musicBrainz: OriginalReleaseMatch | null,
): TrustedOriginalReleaseDecision {
  if (wikidata && musicBrainz) {
    if (wikidata.year !== musicBrainz.year) {
      return {
        status: "conflict",
        wikidataYear: wikidata.year,
        musicBrainzYear: musicBrainz.year,
      };
    }
    return {
      status: "matched",
      match: {
        year: wikidata.year,
        source: "wikidata+musicbrainz",
        sourceId: `wikidata:${wikidata.itemId};musicbrainz:${musicBrainz.recordingId}`,
      },
    };
  }

  const singleSource = wikidata
    ? {
        year: wikidata.year,
        source: "wikidata" as const,
        sourceId: wikidata.itemId,
      }
    : musicBrainz
      ? {
          year: musicBrainz.year,
          source: "musicbrainz" as const,
          sourceId: musicBrainz.recordingId,
        }
      : null;

  if (!singleSource) {
    return { status: "unmatched", reason: "no_exact_source_match" };
  }
  if (song.release_year == null) {
    return { status: "unmatched", reason: "single_source_without_baseline" };
  }

  const correctionYears = song.release_year - singleSource.year;
  if (correctionYears < 0 || correctionYears > 5) {
    return { status: "unmatched", reason: "large_single_source_correction" };
  }

  return { status: "matched", match: singleSource };
}

/**
 * MusicBrainz 検索は同名の再録・再収録を複数返す。
 * 高信頼度かつ曲名・歌手名が一致する録音のうち、最古の初回発売日を選ぶ。
 */
export function selectOriginalReleaseMatch(
  song: OriginalReleaseSong,
  recordings: MusicBrainzRecording[],
): OriginalReleaseMatch | null {
  const title = normalizeReleaseMatchText(song.title);
  const artist = normalizeReleaseMatchText(song.artist);

  const matches = recordings.flatMap((recording) => {
    const score = recording.score ?? 0;
    const release = parseReleaseDate(recording["first-release-date"]);
    if (score < MIN_MUSICBRAINZ_SCORE || !release) return [];
    if (normalizeReleaseMatchText(recording.title) !== title) return [];

    const artistMatches = recordingArtistNames(recording).some(
      (name) => normalizeReleaseMatchText(name) === artist,
    );
    if (!artistMatches) return [];

    // 現行メタデータより新しい値は「原発売」と自動確定しない。
    if (song.release_year != null && release.year > song.release_year) return [];

    return [
      {
        year: release.year,
        date: release.date,
        recordingId: recording.id,
        recordingTitle: recording.title,
        recordingArtist:
          recordingArtistNames(recording)[0] ?? song.artist,
        musicBrainzScore: score,
      } satisfies OriginalReleaseMatch,
    ];
  });

  matches.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      b.musicBrainzScore - a.musicBrainzScore ||
      a.recordingId.localeCompare(b.recordingId),
  );
  return matches[0] ?? null;
}

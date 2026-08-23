/**
 * Wikidata と MusicBrainz を照合し、楽曲の原発売年と出典を補完する。
 *
 * 安全策:
 *  - 既存の release_year は上書きしない
 *  - デフォルトは dry-run。書き込みは --apply が必要
 *  - 各ジャンルの上位候補を同順位ずつ取り、バッチの偏りを防ぐ
 *  - 現行年から5年を超える補正は2出典が同年の場合だけ採用
 *  - matched / conflict / not_found / error を保存し、済みの曲は再照会しない
 *  - MusicBrainz の公開制限に合わせ、1.2秒間隔の単スレッド実行
 *
 * 例:
 *   pnpm backfill:original-release-years --report
 *   pnpm backfill:original-release-years --limit 100
 *   pnpm backfill:original-release-years --limit 100 --apply
 *   pnpm backfill:original-release-years --limit 25 --retry
 *   pnpm backfill:original-release-years --song-id <uuid>
 */
import { buildGenreReleaseYearTargetPlan } from "../src/lib/genre-release-year-targets";
import { GENRE_CODES, GENRE_LABELS } from "../src/lib/genres";
import {
  chooseTrustedOriginalReleaseMatch,
  normalizeReleaseMatchText,
  selectOriginalReleaseMatch,
  selectWikidataOriginalReleaseMatch,
  type MusicBrainzRecording,
  type WikidataReleaseCandidate,
} from "../src/lib/original-release-year";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database, Json } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  genres: string[] | null;
  release_year: number | null;
  original_release_year: number | null;
  original_release_year_check_status: string | null;
  karaoke_score: number | null;
  fame_score: number | null;
  cert_score: number | null;
  dam_request_no: string | null;
  spotify_track_id: string | null;
  range_low_midi: number | null;
  range_high_midi: number | null;
}

interface MusicBrainzResponse {
  recordings?: MusicBrainzRecording[];
}

const MUSICBRAINZ_ENDPOINT = "https://musicbrainz.org/ws/2/recording/";
const WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql";
const USER_AGENT =
  "personal-karaoke-hobby/0.1 (non-commercial hobby project; contact: hiroto.ikeda.oka@gmail.com)";
const REQUEST_INTERVAL_MS = 1200;
const DEFAULT_LIMIT = 100;
const DEFAULT_PER_GENRE_LIMIT = 100;
const COVERAGE_RANKING_SIZE = 50;
const PAGE_SIZE = 1000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function escapeLucenePhrase(value: string) {
  return value.replace(/[\\"]/g, "\\$&");
}

function escapeSparqlLiteral(value: string) {
  return JSON.stringify(value);
}

interface WikidataSparqlResponse {
  results?: {
    bindings?: Array<{
      item?: { value?: string };
      itemLabel?: { value?: string };
      performerLabel?: { value?: string };
      date?: { value?: string };
    }>;
  };
}

async function fetchWikidataCandidates(songs: SongRow[]) {
  if (songs.length === 0) {
    return new Map<string, WikidataReleaseCandidate[]>();
  }

  const titles = [...new Set(songs.map((song) => song.title))];
  const values = titles
    .flatMap((title) => [
      `${escapeSparqlLiteral(title)}@ja`,
      `${escapeSparqlLiteral(title)}@en`,
    ])
    .join(" ");
  const sparql = `
    select ?item ?itemLabel ?date ?performerLabel where {
      values ?title { ${values} }
      ?item rdfs:label ?title;
            wdt:P577 ?date;
            wdt:P175 ?performer.
      service wikibase:label {
        bd:serviceParam wikibase:language "ja,en".
        ?item rdfs:label ?itemLabel.
        ?performer rdfs:label ?performerLabel.
      }
    }
  `;
  const body = new URLSearchParams({ query: sparql, format: "json" });
  const response = await fetch(WIKIDATA_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/sparql-results+json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Wikidata ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as WikidataSparqlResponse;
  const candidates = new Map<string, WikidataReleaseCandidate[]>();
  for (const binding of json.results?.bindings ?? []) {
    const itemUrl = binding.item?.value;
    const title = binding.itemLabel?.value;
    const performer = binding.performerLabel?.value;
    const date = binding.date?.value;
    if (!itemUrl || !title || !performer || !date) continue;
    const candidate: WikidataReleaseCandidate = {
      itemId: itemUrl.split("/").at(-1) ?? itemUrl,
      title,
      performer,
      date,
    };
    const key = normalizeReleaseMatchText(title);
    candidates.set(key, [...(candidates.get(key) ?? []), candidate]);
  }
  return candidates;
}

async function searchMusicBrainz(song: SongRow) {
  const url = new URL(MUSICBRAINZ_ENDPOINT);
  url.searchParams.set(
    "query",
    `recording:"${escapeLucenePhrase(song.title)}" AND artist:"${escapeLucenePhrase(song.artist)}"`,
  );
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", "25");

  for (let attempt = 1; attempt <= 3; attempt++) {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    });
    if (response.ok) return (await response.json()) as MusicBrainzResponse;

    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retryAfter = Number.parseInt(
        response.headers.get("retry-after") ?? "5",
        10,
      );
      await sleep(Math.max(5, retryAfter) * 1000);
      continue;
    }
    throw new Error(`MusicBrainz ${response.status}: ${await response.text()}`);
  }

  return { recordings: [] } satisfies MusicBrainzResponse;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let perGenreLimit = DEFAULT_PER_GENRE_LIMIT;
  let apply = false;
  let retry = false;
  let reportOnly = false;
  const songIds: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--apply") apply = true;
    else if (arg === "--retry") retry = true;
    else if (arg === "--report") reportOnly = true;
    else if (arg === "--limit") {
      limit = Number.parseInt(args[++index] ?? "", 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
        throw new Error("--limit must be an integer between 1 and 1000");
      }
    } else if (arg === "--genre-top") {
      perGenreLimit = Number.parseInt(args[++index] ?? "", 10);
      if (
        !Number.isInteger(perGenreLimit) ||
        perGenreLimit < 1 ||
        perGenreLimit > 500
      ) {
        throw new Error("--genre-top must be an integer between 1 and 500");
      }
    } else if (arg === "--song-id") {
      const id = args[++index];
      if (!id) throw new Error("--song-id requires a UUID");
      songIds.push(id);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return { apply, limit, perGenreLimit, reportOnly, retry, songIds };
}

async function loadAllSongs(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<SongRow[]> {
  const songs: SongRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("songs")
      .select(
        "id, title, artist, artist_id, genres, release_year, original_release_year, original_release_year_check_status, karaoke_score, fame_score, cert_score, dam_request_no, spotify_track_id, range_low_midi, range_high_midi",
      )
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as SongRow[];
    songs.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return songs;
}

async function loadArtistGenres(
  supabase: ReturnType<typeof createAdminClient>,
) {
  const artistGenres = new Map<string, string[]>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, genres")
      .order("id")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const row of rows) artistGenres.set(row.id, row.genres ?? []);
    if (rows.length < PAGE_SIZE) break;
  }
  return artistGenres;
}

function printCoverage(
  rankings: ReturnType<typeof buildGenreReleaseYearTargetPlan<SongRow>>["rankings"],
) {
  const report = GENRE_CODES.map((code) => {
    const topSongs = (rankings.get(code) ?? []).slice(0, COVERAGE_RANKING_SIZE);
    const populated = topSongs.filter(
      (song) => song.original_release_year != null,
    ).length;
    const checked = topSongs.filter(
      (song) => song.original_release_year_check_status != null,
    ).length;
    return {
      genre: GENRE_LABELS[code],
      songs: topSongs.length,
      original_years: populated,
      coverage: topSongs.length
        ? `${Math.round((populated / topSongs.length) * 100)}%`
        : "-",
      checked,
    };
  });
  console.table(report);
}

function providerDetails(
  wikidataYear: number | undefined,
  musicBrainzYear: number | undefined,
): Record<string, Json> {
  const details: Record<string, Json> = {};
  if (wikidataYear != null) details.wikidata_year = wikidataYear;
  if (musicBrainzYear != null) details.musicbrainz_year = musicBrainzYear;
  return details;
}

async function main() {
  const { apply, limit, perGenreLimit, reportOnly, retry, songIds } =
    parseArgs();
  const supabase = createAdminClient();
  const [allSongs, artistGenres] = await Promise.all([
    loadAllSongs(supabase),
    loadArtistGenres(supabase),
  ]);
  const plan = buildGenreReleaseYearTargetPlan(
    allSongs,
    artistGenres,
    GENRE_CODES,
    perGenreLimit,
    new Date().getUTCFullYear(),
  );
  printCoverage(plan.rankings);
  if (reportOnly) return;

  const requestedIds = new Set(songIds);
  const candidates =
    requestedIds.size > 0
      ? allSongs.filter((song) => requestedIds.has(song.id))
      : plan.queue;
  const songs = candidates
    .filter(
      (song) =>
        song.original_release_year == null &&
        (retry || song.original_release_year_check_status == null),
    )
    .slice(0, limit);

  const wikidataCandidates = await fetchWikidataCandidates(songs);
  console.log(
    `original release year: targets=${songs.length}, scope=genre-top-${perGenreLimit}, mode=${apply ? "APPLY" : "DRY-RUN"}, retry=${retry}`,
  );
  if (songs.length === 0) return;

  const persist = async (songId: string, update: SongUpdate) => {
    const { error } = await supabase.from("songs").update(update).eq("id", songId);
    if (error) throw error;
  };

  let matched = 0;
  let unmatched = 0;
  let conflicts = 0;
  let failed = 0;

  for (const [index, song] of songs.entries()) {
    try {
      const response = await searchMusicBrainz(song);
      const musicBrainzMatch = selectOriginalReleaseMatch(
        song,
        response.recordings ?? [],
      );
      const wikidataMatch = selectWikidataOriginalReleaseMatch(
        song,
        wikidataCandidates.get(normalizeReleaseMatchText(song.title)) ?? [],
      );
      const decision = chooseTrustedOriginalReleaseMatch(
        song,
        wikidataMatch,
        musicBrainzMatch,
      );
      const checkedAt = new Date().toISOString();

      if (decision.status === "conflict") {
        conflicts++;
        console.log(
          `[${index + 1}/${songs.length}] source conflict: ${song.title} / ${song.artist}: wikidata=${decision.wikidataYear}, musicbrainz=${decision.musicBrainzYear}`,
        );
        if (apply) {
          await persist(song.id, {
            original_release_year_check_status: "conflict",
            original_release_year_checked_at: checkedAt,
            original_release_year_check_details: providerDetails(
              decision.wikidataYear,
              decision.musicBrainzYear,
            ),
          });
        }
      } else if (decision.status === "unmatched") {
        unmatched++;
        console.log(
          `[${index + 1}/${songs.length}] no confident match: ${song.title} / ${song.artist} (${decision.reason})`,
        );
        if (apply) {
          await persist(song.id, {
            original_release_year_check_status: "not_found",
            original_release_year_checked_at: checkedAt,
            original_release_year_check_details: {
              reason: decision.reason,
              ...providerDetails(
                wikidataMatch?.year,
                musicBrainzMatch?.year,
              ),
            },
          });
        }
      } else {
        const { match } = decision;
        matched++;
        console.log(
          `[${index + 1}/${songs.length}] ${song.title} / ${song.artist}: ${song.release_year ?? "?"} -> ${match.year} [${match.source}] (${match.sourceId})`,
        );
        if (apply) {
          await persist(song.id, {
            original_release_year: match.year,
            original_release_year_source: match.source,
            original_release_year_source_id: match.sourceId,
            original_release_year_updated_at: checkedAt,
            original_release_year_check_status: "matched",
            original_release_year_checked_at: checkedAt,
            original_release_year_check_details: providerDetails(
              wikidataMatch?.year,
              musicBrainzMatch?.year,
            ),
          });
        }
      }
    } catch (error) {
      failed++;
      console.error(
        `[${index + 1}/${songs.length}] failed: ${song.title} / ${song.artist}`,
        error,
      );
      if (apply) {
        try {
          await persist(song.id, {
            original_release_year_check_status: "error",
            original_release_year_checked_at: new Date().toISOString(),
            original_release_year_check_details: {
              reason: "external_request_failed",
            },
          });
        } catch (persistError) {
          console.error(`failed to persist error status for ${song.id}`, persistError);
        }
      }
    }

    if (index < songs.length - 1) await sleep(REQUEST_INTERVAL_MS);
  }

  console.log(
    JSON.stringify(
      {
        targets: songs.length,
        matched,
        unmatched,
        conflicts,
        failed,
        applied: apply,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

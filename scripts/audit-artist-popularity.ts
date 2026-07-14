/**
 * アーティストページの人気順に影響する fame/cert データの欠損・不整合を監査する。
 *
 * ランキング由来の順位・掲載ラベルは取得せず、既に保存可能と整理されている
 * 予測スコアと曲メタデータだけを読む。結果は stdout のみに出し、ファイルや
 * DB は更新しない。
 *
 * 実行:
 *   node --env-file=.env.local --import tsx scripts/audit-artist-popularity.ts
 *   ... --min-karaoke-score=0.15 --limit=30
 */
import { createAdminClient } from "../src/lib/supabase/admin";

const PAGE_SIZE = 1000;
const DEFAULT_MIN_KARAOKE_SCORE = 0.15;
const DEFAULT_LIMIT = 25;
const SONG_SELECT =
  "id, title, artist, artist_id, karaoke_score, fame_score, fame_views, fame_article, cert_score";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  karaoke_score: number | null;
  fame_score: number | null;
  fame_views: number | null;
  fame_article: string | null;
  cert_score: number | null;
}

interface Options {
  minKaraokeScore: number;
  limit: number;
}

interface ArtistAudit {
  artist: string;
  songCount: number;
  uncomputedFameCount: number;
  noArticleCount: number;
  maxKaraokeScore: number;
}

function parseNumberOption(
  argument: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = Number(argument.slice(name.length + 1));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be within ${minimum}..${maximum}`);
  }
  return value;
}

function parseOptions(arguments_: string[]): Options {
  let minKaraokeScore = DEFAULT_MIN_KARAOKE_SCORE;
  let limit = DEFAULT_LIMIT;
  for (const argument of arguments_) {
    if (argument.startsWith("--min-karaoke-score=")) {
      minKaraokeScore = parseNumberOption(
        argument,
        "--min-karaoke-score",
        0,
        1,
      );
    } else if (argument.startsWith("--limit=")) {
      limit = parseNumberOption(argument, "--limit", 1, 500);
      if (!Number.isInteger(limit)) throw new Error("--limit must be an integer");
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { minKaraokeScore, limit };
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja");
}

function songKey(song: SongRow): string {
  return `${normalize(song.artist)}\u0000${normalize(song.title)}`;
}

function artistKey(song: SongRow): string {
  return song.artist_id ?? `name:${normalize(song.artist)}`;
}

async function fetchAllSongs(): Promise<SongRow[]> {
  const supabase = createAdminClient();
  const rows: SongRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("songs")
      .select(SONG_SELECT)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`songs audit failed at ${from}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function printSongs(title: string, songs: SongRow[], limit: number): void {
  console.log(`\n${title} (${songs.length})`);
  for (const song of songs.slice(0, limit)) {
    console.log(
      `  ${song.artist} / ${song.title}` +
        ` | karaoke=${song.karaoke_score?.toFixed(4) ?? "NULL"}` +
        ` fame=${song.fame_score ?? "NULL"}` +
        ` views=${song.fame_views ?? "NULL"}` +
        ` cert=${song.cert_score ?? "NULL"}` +
        ` article=${song.fame_article ?? "NULL"}`,
    );
  }
}

function auditArtists(songs: SongRow[]): ArtistAudit[] {
  const groups = new Map<string, ArtistAudit>();
  for (const song of songs) {
    const key = artistKey(song);
    const audit = groups.get(key) ?? {
      artist: song.artist,
      songCount: 0,
      uncomputedFameCount: 0,
      noArticleCount: 0,
      maxKaraokeScore: 0,
    };
    audit.songCount += 1;
    if (song.fame_score === null) audit.uncomputedFameCount += 1;
    if (song.fame_score === 0) audit.noArticleCount += 1;
    audit.maxKaraokeScore = Math.max(
      audit.maxKaraokeScore,
      song.karaoke_score ?? 0,
    );
    groups.set(key, audit);
  }
  return [...groups.values()];
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const songs = await fetchAllSongs();
  const uncomputedFame = songs.filter((song) => song.fame_score === null).length;
  const noArticle = songs.filter((song) => song.fame_score === 0).length;
  const computedPositive = songs.length - uncomputedFame - noArticle;
  const certPresent = songs.filter((song) => song.cert_score !== null).length;
  const karaokePresent = songs.filter((song) => song.karaoke_score !== null).length;

  console.log("Artist popularity data audit (read-only)");
  console.log(`catalog songs: ${songs.length}`);
  console.log(
    `fame: computed-positive=${computedPositive}, no-article=${noArticle}, ` +
      `uncomputed=${uncomputedFame}`,
  );
  console.log(`cert present: ${certPresent}; karaoke_score present: ${karaokePresent}`);

  const highPredictionMissingFame = songs
    .filter(
      (song) =>
        (song.karaoke_score ?? -1) >= options.minKaraokeScore &&
        (song.fame_score === null || song.fame_score === 0),
    )
    .sort((a, b) => (b.karaoke_score ?? -1) - (a.karaoke_score ?? -1));
  printSongs(
    `karaoke_score >= ${options.minKaraokeScore} with fame NULL/0`,
    highPredictionMissingFame,
    options.limit,
  );

  const resolvedArticleWithoutScore = songs
    .filter(
      (song) =>
        song.fame_article !== null &&
        (song.fame_score === null ||
          song.fame_score === 0 ||
          song.fame_views === null ||
          song.fame_views === 0),
    )
    .sort((a, b) => (b.karaoke_score ?? -1) - (a.karaoke_score ?? -1));
  printSongs(
    "resolved fame_article with missing/zero score or views",
    resolvedArticleWithoutScore,
    options.limit,
  );

  const byArticle = new Map<string, SongRow[]>();
  for (const song of songs) {
    if (!song.fame_article) continue;
    const key = normalize(song.fame_article);
    byArticle.set(key, [...(byArticle.get(key) ?? []), song]);
  }
  const articleCollisions = [...byArticle.entries()]
    .filter(([, matches]) => new Set(matches.map(songKey)).size > 1)
    .sort((a, b) => b[1].length - a[1].length);
  console.log(
    `\nfame_article shared by different artist/title keys (${articleCollisions.length})`,
  );
  for (const [article, matches] of articleCollisions.slice(0, options.limit)) {
    console.log(`  ${article}: ${matches.map((song) => `${song.artist} / ${song.title}`).join(" | ")}`);
  }

  const artistAudits = auditArtists(songs)
    .filter((audit) => audit.songCount >= 5 && audit.uncomputedFameCount > 0)
    .sort((a, b) => {
      const aRatio = a.uncomputedFameCount / a.songCount;
      const bRatio = b.uncomputedFameCount / b.songCount;
      return bRatio - aRatio || b.maxKaraokeScore - a.maxKaraokeScore;
    });
  console.log(`\nartists with >=5 songs and uncomputed fame (${artistAudits.length})`);
  for (const audit of artistAudits.slice(0, options.limit)) {
    console.log(
      `  ${audit.artist}: NULL=${audit.uncomputedFameCount}/${audit.songCount}` +
        ` (${((audit.uncomputedFameCount / audit.songCount) * 100).toFixed(1)}%)` +
        ` no-article=${audit.noArticleCount}` +
        ` max-karaoke=${audit.maxKaraokeScore.toFixed(4)}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

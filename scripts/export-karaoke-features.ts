/**
 * songs と artists からカラオケ人気モデル用の特徴量だけを JSONL に出力する。
 *
 * 実行: pnpm export:karaoke-features
 * 出力: scraper/output/karaoke_features.jsonl
 *
 * ランキング由来の順位・掲載有無・DAM 請求番号は読み込まず、出力もしない。
 * Supabase Data API の最大 1000 行制限を避けるため、全テーブルを range() で
 * 安定した id 順にページ送りする。
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

const PAGE_SIZE = 1000;
const OUTPUT_PATH = resolve(
  process.cwd(),
  "scraper/output/karaoke_features.jsonl",
);
const SONG_SELECT =
  "id, title, artist, artist_id, fame_score, fame_views, cert_score, release_year, duration_ms, genres, range_low_midi, range_high_midi, falsetto_max_midi";

interface ArtistRow {
  id: string;
  genres: string[];
}

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  fame_score: number | null;
  fame_views: number | null;
  cert_score: number | null;
  release_year: number | null;
  duration_ms: number | null;
  genres: string[] | null;
  range_low_midi: number | null;
  range_high_midi: number | null;
  falsetto_max_midi: number | null;
}

interface ArtistAggregate {
  songCount: number;
  fameScores: number[];
  certScores: number[];
  spotifyPopularities: number[];
}

async function fetchAllArtists(): Promise<ArtistRow[]> {
  const supabase = createAdminClient();
  const rows: ArtistRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, genres")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`artists export failed at ${from}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
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
    if (error) throw new Error(`songs export failed at ${from}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

function artistKey(song: SongRow): string {
  return song.artist_id ?? `name:${song.artist.normalize("NFKC").toLowerCase()}`;
}

function maximum(values: number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

async function main() {
  const [artists, songs] = await Promise.all([
    fetchAllArtists(),
    fetchAllSongs(),
  ]);
  const artistGenres = new Map(artists.map((artist) => [artist.id, artist.genres]));
  const aggregates = new Map<string, ArtistAggregate>();

  for (const song of songs) {
    const key = artistKey(song);
    const aggregate = aggregates.get(key) ?? {
      songCount: 0,
      fameScores: [],
      certScores: [],
      spotifyPopularities: [],
    };
    aggregate.songCount += 1;
    if (song.fame_score !== null) aggregate.fameScores.push(song.fame_score);
    if (song.cert_score !== null) aggregate.certScores.push(song.cert_score);
    aggregates.set(key, aggregate);
  }

  const seenIds = new Set<string>();
  const lines = songs.map((song) => {
    if (seenIds.has(song.id)) throw new Error(`duplicate song id: ${song.id}`);
    seenIds.add(song.id);
    const aggregate = aggregates.get(artistKey(song));
    if (!aggregate) throw new Error(`missing artist aggregate for song ${song.id}`);

    return JSON.stringify({
      song_id: song.id,
      title: song.title,
      artist: song.artist,
      fame_score: song.fame_score,
      fame_views: song.fame_views,
      cert_score: song.cert_score,
      release_year: song.release_year,
      duration_ms: song.duration_ms,
      genres: song.genres ?? [],
      artist_genres: song.artist_id
        ? (artistGenres.get(song.artist_id) ?? [])
        : [],
      range_low_midi: song.range_low_midi,
      range_high_midi: song.range_high_midi,
      falsetto_max_midi: song.falsetto_max_midi,
      artist_song_count: aggregate.songCount,
      artist_max_fame_score: maximum(aggregate.fameScores),
      artist_mean_fame_score: mean(aggregate.fameScores),
      artist_max_cert_score: maximum(aggregate.certScores),
    });
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  writeFileSync(temporaryPath, `${lines.join("\n")}\n`, "utf8");
  renameSync(temporaryPath, OUTPUT_PATH);
  console.log(
    `exported ${songs.length} songs and ${artists.length} artists to ${OUTPUT_PATH}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

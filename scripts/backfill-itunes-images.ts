/**
 * iTunes Search API 経由で `image_url_medium IS NULL` な楽曲に
 * ジャケ画像 / duration_ms / release_year (NULL の場合のみ) / preview_url を補完する。
 *
 * 設計:
 *  - iTunes Search API は無料・無認証。公式非明記だが ~20 req/min/IP が安全圏。
 *  - 並列 4 ワーカー × 1s 間隔 = ~4 req/sec で 13K 曲を ~1 時間で処理する設計。
 *  - 429 を喰らったワーカーは個別に 60s スリープ後リトライ。
 *  - 結果を `scraper/output/itunes_image_cache.jsonl` に append (resume 用)。
 *
 * カラオケ/オルゴール/カバー版の判定ロジックは `scraper/src/fetch_itunes.py` を移植。
 *
 * 使い方:
 *   pnpm backfill:itunes-images                 # 全件処理
 *   pnpm backfill:itunes-images -- --limit 30   # 先頭 30 件 (動作確認)
 *   pnpm backfill:itunes-images -- --dry-run    # API は叩くが DB は更新しない
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

// --- Config -----------------------------------------------------------------

const USER_AGENT =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const ENDPOINT = "https://itunes.apple.com/search";
const CACHE_PATH = resolve(
  process.cwd(),
  "scraper/output/itunes_image_cache.jsonl",
);

const CONCURRENCY = 2;
const PER_WORKER_INTERVAL_MS = 700;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MIN_TITLE_SIMILARITY = 0.55;
const MIN_ARTIST_SIMILARITY = 0.4;

// --- Karaoke/cover detection (fetch_itunes.py 移植) -----------------------

const KARAOKE_ARTIST_KEYWORDS = [
  "歌っちゃ王",
  "カラオケ歌っちゃ王",
  "オルゴール",
  "music box",
  "piano echoes",
  "piano cover",
  "piano dreamers",
  "ピアノ生演奏",
  "vega☆オーケストラ",
  "music box ensemble",
  "instrumental",
  "study music",
  "cafe music",
  "lullaby",
  "sleep music",
];

const KARAOKE_TRACK_KEYWORDS = [
  "(カラオケ)",
  "(オルゴール)",
  "(piano",
  "(off vocal)",
  "オフボーカル",
  "オフ・ボーカル",
  "(原曲歌手",
  "[原曲歌手",
  "(ガイド",
  "ガイド無し",
  "ガイドなし",
  "(instrumental",
  "[instrumental",
  " - instrumental",
  "(inst.)",
  "(inst)",
  "(オリジナル・カラオケ)",
  "(off-vocal)",
  "オリジナル・カラオケ",
  "(tv size)",
  "(tv-size)",
  "(tv version)",
  "(tv ver",
  "(tvサイズ)",
  "(tv-edit)",
  "(short ver",
  "(short version)",
  "(short edit)",
  "(movie size)",
  "(movie ver",
];

function isKaraokeOrCover(artistName: string, trackName: string): boolean {
  const a = artistName.toLowerCase();
  const t = trackName.toLowerCase();
  if (KARAOKE_ARTIST_KEYWORDS.some((k) => a.includes(k.toLowerCase())))
    return true;
  if (KARAOKE_TRACK_KEYWORDS.some((k) => t.includes(k.toLowerCase())))
    return true;
  return false;
}

// --- Text utilities ---------------------------------------------------------

const RE_ROMAJI_SUFFIX = /\s+-\s+[A-Za-z0-9][A-Za-z0-9\s.()\-']*$/;

function normalize(s: string): string {
  if (!s) return "";
  return s
    .replace(RE_ROMAJI_SUFFIX, "")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/\b(?:feat\.?|featuring|with)\b.*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array<number>(b.length + 1);
  let cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

// --- Types ------------------------------------------------------------------

interface SongRow {
  id: string;
  title: string;
  artist: string;
  release_year: number | null;
  duration_ms: number | null;
}

interface ItunesResult {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  previewUrl?: string;
  trackViewUrl?: string;
}

interface CacheRecord {
  song_id: string;
  matched: boolean;
  title?: string;
  artist?: string;
  similarity?: number;
  reason?: string;
}

// --- Cache ------------------------------------------------------------------

function loadProcessedSongIds(): Set<string> {
  const set = new Set<string>();
  if (!existsSync(CACHE_PATH)) return set;
  const lines = readFileSync(CACHE_PATH, "utf8").split("\n").filter(Boolean);
  for (const ln of lines) {
    try {
      const r = JSON.parse(ln) as CacheRecord;
      set.add(r.song_id);
    } catch {
      // skip malformed
    }
  }
  return set;
}

function appendCache(record: CacheRecord) {
  appendFileSync(CACHE_PATH, JSON.stringify(record) + "\n");
}

// --- iTunes call ------------------------------------------------------------

async function searchItunes(
  query: string,
): Promise<{ results: ItunesResult[]; rateLimited: boolean }> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("term", query);
  url.searchParams.set("country", "jp");
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": USER_AGENT },
  });
  if (res.status === 429) {
    return { results: [], rateLimited: true };
  }
  if (!res.ok) {
    throw new Error(`itunes ${res.status}`);
  }
  const json = (await res.json()) as { results?: ItunesResult[] };
  return { results: json.results ?? [], rateLimited: false };
}

/** 100x100 → 600x600 にサイズ変換 (URL の `100x100bb.jpg` を置換)。 */
function resizeArtwork(url: string, size: number): string {
  return url.replace(/\d+x\d+bb\.(jpg|png)/i, `${size}x${size}bb.$1`);
}

// --- Match logic ------------------------------------------------------------

function pickBestMatch(
  songTitle: string,
  songArtist: string,
  results: ItunesResult[],
): { result: ItunesResult; titleSim: number; artistSim: number } | null {
  let best: { result: ItunesResult; titleSim: number; artistSim: number } | null =
    null;
  for (const r of results) {
    if (!r.trackName || !r.artistName || !r.artworkUrl100) continue;
    if (isKaraokeOrCover(r.artistName, r.trackName)) continue;
    const ts = similarity(songTitle, r.trackName);
    const as = similarity(songArtist, r.artistName);
    if (ts < MIN_TITLE_SIMILARITY) continue;
    if (as < MIN_ARTIST_SIMILARITY) continue;
    const score = ts * 0.7 + as * 0.3;
    const bestScore = best
      ? best.titleSim * 0.7 + best.artistSim * 0.3
      : -Infinity;
    if (score > bestScore) {
      best = { result: r, titleSim: ts, artistSim: as };
    }
  }
  return best;
}

// --- Worker -----------------------------------------------------------------

interface WorkerStats {
  processed: number;
  matched: number;
  unmatched: number;
  rateLimited: number;
}

async function worker(
  id: number,
  queue: SongRow[],
  cursor: { i: number },
  totalLen: number,
  stats: WorkerStats,
  dryRun: boolean,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<void> {
  while (true) {
    const i = cursor.i++;
    if (i >= queue.length) return;
    const song = queue[i];
    // アーティスト名のカッコ部分は alias 表記であることが多く、検索ノイズになる。
    // (例: "THE HIGH-LOWS(ザ・ハイロウズ)" → "THE HIGH-LOWS")
    const cleanArtist = song.artist
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[[【][^\]】]*[\]】]/g, "")
      .trim();
    const query = `${song.title} ${cleanArtist}`;

    let attempts = 0;
    let response: { results: ItunesResult[]; rateLimited: boolean } | null = null;
    let giveUpReason: string | null = null;
    while (attempts < 3) {
      try {
        response = await searchItunes(query);
        if (response.rateLimited) {
          stats.rateLimited++;
          await sleep(RATE_LIMIT_BACKOFF_MS);
          attempts++;
          response = null; // 次のリトライへ
          continue;
        }
        break;
      } catch (e) {
        attempts++;
        await sleep(2000);
        if (attempts >= 3) {
          giveUpReason = `error: ${(e as Error).message}`;
          response = null;
        }
      }
    }

    if (!response) {
      appendCache({
        song_id: song.id,
        matched: false,
        reason: giveUpReason ?? "rate_limited",
      });
      stats.unmatched++;
      stats.processed++;
      await sleep(PER_WORKER_INTERVAL_MS);
      continue;
    }

    const match = pickBestMatch(song.title, song.artist, response.results);
    if (!match) {
      appendCache({ song_id: song.id, matched: false, reason: "no_match" });
      stats.unmatched++;
    } else {
      const r = match.result;
      const artworkSmall = r.artworkUrl100!;
      const artworkMedium = resizeArtwork(artworkSmall, 600);
      const artworkLarge = resizeArtwork(artworkSmall, 1200);
      const updates: SongUpdate = {
        image_url_small: artworkSmall,
        image_url_medium: artworkMedium,
        image_url_large: artworkLarge,
      };
      if (song.duration_ms == null && r.trackTimeMillis) {
        updates.duration_ms = r.trackTimeMillis;
      }
      if (song.release_year == null && r.releaseDate) {
        const y = parseInt(r.releaseDate.slice(0, 4), 10);
        if (Number.isFinite(y)) updates.release_year = y;
      }
      if (!dryRun) {
        await supabase.from("songs").update(updates).eq("id", song.id);
      }
      appendCache({
        song_id: song.id,
        matched: true,
        title: r.trackName,
        artist: r.artistName,
        similarity: match.titleSim * 0.7 + match.artistSim * 0.3,
      });
      stats.matched++;
    }
    stats.processed++;

    if (stats.processed % 50 === 0) {
      console.log(
        `  progress: ${stats.processed}/${totalLen} ` +
          `(matched=${stats.matched}, unmatched=${stats.unmatched}, rateLimited=${stats.rateLimited})`,
      );
    }

    await sleep(PER_WORKER_INTERVAL_MS);
  }
}

// --- Main -------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[i + 1] ?? "0", 10);
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { limit, dryRun };
}

async function main() {
  const { limit, dryRun } = parseArgs();
  const supabase = createAdminClient();
  const processed = loadProcessedSongIds();
  console.log(`resume cache: ${processed.size} song_ids already attempted`);

  // image_url_medium IS NULL な楽曲を全件取得 (ページング)。
  // 並び: fame_score 降順 NULLS LAST → 有名曲を先に処理して途中で止まっても価値が高い順に埋まる。
  const targets: SongRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, release_year, duration_ms, fame_score")
      .is("image_url_medium", null)
      .order("fame_score", { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<SongRow & { fame_score: number | null }>;
    for (const r of rows) {
      if (processed.has(r.id)) continue;
      targets.push({
        id: r.id,
        title: r.title,
        artist: r.artist,
        release_year: r.release_year,
        duration_ms: r.duration_ms,
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const queue = limit !== null ? targets.slice(0, limit) : targets;
  console.log(
    `total no-image songs (excluding resume): ${targets.length}, processing: ${queue.length}, dryRun=${dryRun}`,
  );
  if (queue.length === 0) {
    console.log("nothing to do.");
    return;
  }

  const stats: WorkerStats = {
    processed: 0,
    matched: 0,
    unmatched: 0,
    rateLimited: 0,
  };
  const cursor = { i: 0 };
  const workers: Promise<void>[] = [];
  const conc = Math.min(CONCURRENCY, queue.length);
  for (let w = 0; w < conc; w++) {
    workers.push(
      worker(w, queue, cursor, queue.length, stats, dryRun, supabase),
    );
  }
  await Promise.all(workers);

  console.log("\n=== summary ===");
  console.log(JSON.stringify(stats, null, 2));
  console.log(`done (${dryRun ? "DRY-RUN" : "applied"}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

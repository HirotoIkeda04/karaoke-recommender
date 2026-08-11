/**
 * iTunes Search API 経由で `duration_ms IS NULL` な楽曲に
 * duration_ms (主目的) / release_year / 画像 (いずれも欠損時のみ) を補完する。
 *
 * 設計判断 (2026-05-15):
 *  - 楽曲の長さは従来 Spotify 経由で取っていたが、Spotify の新規アプリ向け
 *    制限 (/v1/tracks?ids= が 403, limit≤10, quota 500/夜) で非効率だった。
 *  - iTunes Search API は無料・無認証・実質無制限。trackTimeMillis で長さが
 *    そのまま返るため、duration backfill は iTunes 主軸に切替。
 *  - spotify_track_id 自体は別用途 (聴取バッジ / Spotify で開く) があるので
 *    引き続き match:dam で取得するが、duration はこちらで埋める。
 *
 * 対象選定:
 *  - duration_ms IS NULL の曲全て (画像の有無は問わない)
 *  - created_at 降順 = 新しい曲ほど iTunes JP のヒット率が高い経験則に従う
 *
 * 補完ポリシー:
 *  - duration_ms: マッチしたら必ずセット (主目的)
 *  - release_year: NULL の時のみ
 *  - image_url_*: NULL の時のみ (Spotify 由来の既存画像は上書きしない)
 *
 * iTunes レート: 単スレ + 3.5s 間隔 (~17 req/min, 公称 20/min 内)。
 * 過去 (2026-05-05) に並列 4 / 0.7s で 403 soft-ban を喰らったため保守設定。
 * カラオケ/オルゴール/カバー版判定は fetch_itunes.py 移植 (images 版と同一)。
 *
 * 使い方:
 *   pnpm backfill:itunes-metadata --dry-run
 *   pnpm backfill:itunes-metadata --limit 30
 *   pnpm backfill:itunes-metadata
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

const USER_AGENT =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";
const ENDPOINT = "https://itunes.apple.com/search";
const CACHE_PATH = resolve(
  process.cwd(),
  "scraper/output/itunes_metadata_cache.jsonl",
);

const PER_REQUEST_INTERVAL_MS = 3500;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MIN_TITLE_SIMILARITY = 0.55;
const MIN_ARTIST_SIMILARITY = 0.4;

// --- Karaoke/cover detection (fetch_itunes.py 移植, images 版と同一) --------

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
    .replace(/『[^』]*』/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/\b(?:feat\.?|featuring|with)\b.*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
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

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  return 1 - dist / Math.max(na.length, nb.length);
}

// --- Types ------------------------------------------------------------------

interface SongRow {
  id: string;
  title: string;
  artist: string;
  release_year: number | null;
  duration_ms: number | null;
  image_url_medium: string | null;
}

interface ItunesResult {
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
}

interface CacheRecord {
  song_id: string;
  matched: boolean;
  title?: string;
  artist?: string;
  reason?: string;
}

// --- Cache ------------------------------------------------------------------

function loadProcessedSongIds(): Set<string> {
  const set = new Set<string>();
  if (!existsSync(CACHE_PATH)) return set;
  for (const ln of readFileSync(CACHE_PATH, "utf8").split("\n").filter(Boolean)) {
    try {
      const rec = JSON.parse(ln) as CacheRecord;
      // レート制限/通信エラーはログとして残すが「処理済み」とは見なさず、
      // 次回実行で再挑戦させる (matched / no_match だけを resume 対象にする)
      if (rec.reason === "rate_limited" || rec.reason?.startsWith("error")) {
        continue;
      }
      set.add(rec.song_id);
    } catch {
      /* skip malformed */
    }
  }
  return set;
}

function appendCache(record: CacheRecord) {
  appendFileSync(CACHE_PATH, JSON.stringify(record) + "\n");
}

// --- iTunes -----------------------------------------------------------------

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
  // 403 (soft-ban) も 429 同様にレート制限扱いでバックオフ
  if (res.status === 429 || res.status === 403) {
    return { results: [], rateLimited: true };
  }
  if (!res.ok) throw new Error(`itunes ${res.status}`);
  const json = (await res.json()) as { results?: ItunesResult[] };
  return { results: json.results ?? [], rateLimited: false };
}

function resizeArtwork(url: string, size: number): string {
  return url.replace(/\d+x\d+bb\.(jpg|png)/i, `${size}x${size}bb.$1`);
}

function pickBestMatch(
  songTitle: string,
  songArtist: string,
  results: ItunesResult[],
): { result: ItunesResult; titleSim: number; artistSim: number } | null {
  let best:
    | { result: ItunesResult; titleSim: number; artistSim: number }
    | null = null;
  for (const r of results) {
    if (!r.trackName || !r.artistName) continue;
    // duration backfill が主目的なので trackTimeMillis が無い結果は無価値
    if (!r.trackTimeMillis) continue;
    if (isKaraokeOrCover(r.artistName, r.trackName)) continue;
    const ts = similarity(songTitle, r.trackName);
    const as = similarity(songArtist, r.artistName);
    if (ts < MIN_TITLE_SIMILARITY) continue;
    if (as < MIN_ARTIST_SIMILARITY) continue;
    const score = ts * 0.7 + as * 0.3;
    const bestScore = best
      ? best.titleSim * 0.7 + best.artistSim * 0.3
      : -Infinity;
    if (score > bestScore) best = { result: r, titleSim: ts, artistSim: as };
  }
  return best;
}

// --- Main -------------------------------------------------------------------

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let dryRun = false;
  // order: "recent" = created_at 降順 (新曲優先, iTunes ヒット率高)
  //        "fame"   = fame_score 降順 NULLS LAST (有名曲優先)
  let order: "recent" | "fame" = "recent";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[i + 1] ?? "0", 10);
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--order") {
      const v = args[i + 1];
      if (v === "fame" || v === "recent") order = v;
    }
  }
  return { limit, dryRun, order };
}

async function main() {
  const { limit, dryRun, order } = parseArgs();
  const supabase = createAdminClient();
  const processed = loadProcessedSongIds();
  console.log(
    `resume cache: ${processed.size} song_ids already attempted, order=${order}`,
  );

  // duration_ms IS NULL の曲を取得。
  //   order=recent: created_at 降順 (新曲ほど iTunes JP ヒット率が高い)
  //   order=fame:   fame_score 降順 NULLS LAST (有名曲のページを優先で埋める)
  const targets: SongRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    let query = supabase
      .from("songs")
      .select(
        "id, title, artist, release_year, duration_ms, image_url_medium, created_at",
      )
      .is("duration_ms", null);
    query =
      order === "fame"
        ? query.order("fame_score", { ascending: false, nullsFirst: false })
        : query.order("created_at", { ascending: false });
    // 同値の並びが頁間で揺れて取りこぼさないよう PK で安定化
    query = query.order("id", { ascending: true });
    const { data, error } = await query.range(offset, offset + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<SongRow & { created_at: string }>;
    for (const r of rows) {
      if (processed.has(r.id)) continue;
      targets.push({
        id: r.id,
        title: r.title,
        artist: r.artist,
        release_year: r.release_year,
        duration_ms: r.duration_ms,
        image_url_medium: r.image_url_medium,
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const queue = limit !== null ? targets.slice(0, limit) : targets;
  console.log(
    `no-duration songs (excl. resume): ${targets.length}, processing: ${queue.length}, dryRun=${dryRun}`,
  );
  if (queue.length === 0) {
    console.log("nothing to do.");
    return;
  }

  let processedN = 0;
  let matched = 0;
  let unmatched = 0;
  let rateLimited = 0;
  let updateFailed = 0;

  for (const song of queue) {
    const cleanArtist = song.artist
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[[【][^\]】]*[\]】]/g, "")
      .trim();
    const query = `${song.title} ${cleanArtist}`;

    let attempts = 0;
    let response: { results: ItunesResult[]; rateLimited: boolean } | null =
      null;
    let giveUpReason: string | null = null;
    while (attempts < 3) {
      try {
        response = await searchItunes(query);
        if (response.rateLimited) {
          rateLimited++;
          await sleep(RATE_LIMIT_BACKOFF_MS);
          attempts++;
          response = null;
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
      // dry-run はキャッシュを書かない (本実行がその曲を飛ばしてしまうため)。
      // rate_limited/error は書いても resume 対象外なので次回再挑戦される。
      if (!dryRun) {
        appendCache({
          song_id: song.id,
          matched: false,
          reason: giveUpReason ?? "rate_limited",
        });
      }
      unmatched++;
      processedN++;
      await sleep(PER_REQUEST_INTERVAL_MS);
      continue;
    }

    const match = pickBestMatch(song.title, song.artist, response.results);
    if (!match) {
      if (!dryRun) {
        appendCache({ song_id: song.id, matched: false, reason: "no_match" });
      }
      unmatched++;
    } else {
      const r = match.result;
      const updates: SongUpdate = {};
      // duration は主目的: マッチしたら必ずセット
      if (r.trackTimeMillis) updates.duration_ms = r.trackTimeMillis;
      // release_year は欠損時のみ
      if (song.release_year == null && r.releaseDate) {
        const y = parseInt(r.releaseDate.slice(0, 4), 10);
        if (Number.isFinite(y)) updates.release_year = y;
      }
      // 画像も欠損時のみ (Spotify 由来の既存画像は温存)
      if (song.image_url_medium == null && r.artworkUrl100) {
        updates.image_url_small = r.artworkUrl100;
        updates.image_url_medium = resizeArtwork(r.artworkUrl100, 600);
        updates.image_url_large = resizeArtwork(r.artworkUrl100, 1200);
      }
      if (Object.keys(updates).length > 0 && !dryRun) {
        const { error: updErr } = await supabase
          .from("songs")
          .update(updates)
          .eq("id", song.id);
        if (updErr) {
          // 書けなかった曲はキャッシュに刻まず次回実行でやり直す
          console.warn(`update failed for ${song.id}: ${updErr.message}`);
          updateFailed++;
          processedN++;
          await sleep(PER_REQUEST_INTERVAL_MS);
          continue;
        }
      }
      if (!dryRun) {
        appendCache({
          song_id: song.id,
          matched: true,
          title: r.trackName,
          artist: r.artistName,
        });
      }
      matched++;
    }
    processedN++;
    if (processedN % 50 === 0) {
      console.log(
        `  progress: ${processedN}/${queue.length} (matched=${matched}, unmatched=${unmatched}, rateLimited=${rateLimited})`,
      );
    }
    await sleep(PER_REQUEST_INTERVAL_MS);
  }

  console.log("\n=== summary ===");
  console.log(
    JSON.stringify(
      { processed: processedN, matched, unmatched, rateLimited, updateFailed },
      null,
      2,
    ),
  );
  console.log(`done (${dryRun ? "DRY-RUN" : "applied"}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

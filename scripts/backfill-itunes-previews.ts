/**
 * iTunes Search API 経由で楽曲のプレビュー音源 URL (previewUrl, 30 秒 AAC)
 * を songs.itunes_preview_url に補完する。ホームのレコードデッキの
 * 試聴再生 (頭 6 秒スニペット) に使う。
 *
 * 設計判断 (2026-08-11):
 *  - Spotify の spotify_preview_url は 2026-02 の API 変更で Dev Mode
 *    アプリに返らなくなったため、音源は iTunes を正とする。
 *  - 検索・マッチング・レート制御は backfill-itunes-metadata.ts と同一
 *    (fetch_itunes.py 移植のカラオケ/カバー版除外 + 類似度マッチ)。
 *  - 試行結果は成功/失敗を問わず itunes_preview_checked_at に記録し、
 *    再実行時に同じ曲を再検索しない (ローカルの JSONL キャッシュとは
 *    独立に、DB 側でも resume できる)。
 *
 * 対象選定:
 *  - itunes_preview_checked_at IS NULL の曲
 *  - デフォルトはホームに出やすい順 (is_popular 降順 → fame_score 降順
 *    NULLS LAST)。--order recent で created_at 降順に切替可能。
 *
 * 補完ポリシー:
 *  - itunes_preview_url / itunes_track_id: マッチしたらセット (主目的)
 *  - duration_ms: NULL の時のみついでに補完 (metadata 版と同じ方針)
 *  - itunes_preview_checked_at: 試行したら必ずセット
 *
 * iTunes レート: 単スレ + 3.5s 間隔 (~17 req/min, 公称 20/min 内)。
 * 過去 (2026-05-05) に並列 4 / 0.7s で 403 soft-ban を喰らったため保守設定。
 *
 * 使い方:
 *   pnpm backfill:itunes-previews --dry-run
 *   pnpm backfill:itunes-previews --limit 30
 *   pnpm backfill:itunes-previews --order recent
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
  "scraper/output/itunes_preview_cache.jsonl",
);

const PER_REQUEST_INTERVAL_MS = 3500;
const RATE_LIMIT_BACKOFF_MS = 60_000;
const MIN_TITLE_SIMILARITY = 0.55;
const MIN_ARTIST_SIMILARITY = 0.4;

// --- Karaoke/cover detection (fetch_itunes.py 移植, metadata 版と同一) ------

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
  duration_ms: number | null;
}

interface ItunesResult {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
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
    // プレビュー取得が主目的なので previewUrl が無い結果は無価値
    if (!r.previewUrl) continue;
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
  // order: "popular" = is_popular 降順 → fame_score 降順 (ホームに出る曲を優先)
  //        "recent"  = created_at 降順 (新曲優先, iTunes ヒット率高)
  let order: "popular" | "recent" = "popular";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[i + 1] ?? "0", 10);
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--order") {
      const v = args[i + 1];
      if (v === "popular" || v === "recent") order = v;
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

  // itunes_preview_checked_at IS NULL の曲を取得。
  //   order=popular: is_popular 降順 → fame_score 降順 (ホーム表示曲を優先)
  //   order=recent:  created_at 降順
  const targets: SongRow[] = [];
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    let query = supabase
      .from("songs")
      .select("id, title, artist, duration_ms, created_at")
      .is("itunes_preview_checked_at", null);
    query =
      order === "popular"
        ? query
            .order("is_popular", { ascending: false })
            .order("fame_score", { ascending: false, nullsFirst: false })
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
        duration_ms: r.duration_ms,
      });
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  const queue = limit !== null ? targets.slice(0, limit) : targets;
  console.log(
    `unchecked songs (excl. resume): ${targets.length}, processing: ${queue.length}, dryRun=${dryRun}`,
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
      // 通信エラー/レート制限で試行しきれなかった曲は checked_at を刻まず、
      // 次回実行で再挑戦できるようにする (キャッシュにはログとして記録する
      // が、loadProcessedSongIds はこの reason を resume 対象から除外する)。
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
    const checkedAt = new Date().toISOString();
    // dry-run はキャッシュも書かない (書くと本実行がその曲を飛ばしてしまう)
    if (!match) {
      if (!dryRun) {
        const { error: updErr } = await supabase
          .from("songs")
          .update({ itunes_preview_checked_at: checkedAt })
          .eq("id", song.id);
        if (updErr) {
          // 書けなかった曲はキャッシュに刻まず次回実行でやり直す
          console.warn(`update failed for ${song.id}: ${updErr.message}`);
          updateFailed++;
          processedN++;
          await sleep(PER_REQUEST_INTERVAL_MS);
          continue;
        }
        appendCache({ song_id: song.id, matched: false, reason: "no_match" });
      }
      unmatched++;
    } else {
      const r = match.result;
      const updates: SongUpdate = {
        itunes_preview_url: r.previewUrl,
        itunes_track_id: r.trackId ?? null,
        itunes_preview_checked_at: checkedAt,
      };
      // duration はついでに欠損時のみ補完 (metadata 版と同じポリシー)
      if (song.duration_ms == null && r.trackTimeMillis) {
        updates.duration_ms = r.trackTimeMillis;
      }
      if (!dryRun) {
        const { error: updErr } = await supabase
          .from("songs")
          .update(updates)
          .eq("id", song.id);
        if (updErr) {
          console.warn(`update failed for ${song.id}: ${updErr.message}`);
          updateFailed++;
          processedN++;
          await sleep(PER_REQUEST_INTERVAL_MS);
          continue;
        }
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

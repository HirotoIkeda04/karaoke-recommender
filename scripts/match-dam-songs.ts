/**
 * DB 上の `spotify_track_id IS NULL` 楽曲を fame_score 降順で Spotify とマッチさせ、
 * 該当 song 行を直接 UPDATE する。
 *
 * 対象: 主に DAM 由来の有名曲(karaoto featured とは別経路で投入された行)。
 *
 * 使い方:
 *   pnpm match:dam            # 既定 --max-new 300
 *   pnpm match:dam -- --max-new 100
 *
 * 仕様:
 * - fame_cache.jsonl に fame_score がある曲のみ対象 (=有名曲のみ)
 * - 過去のマッチ結果は scraper/output/dam_match_cache.jsonl に append (resume 用)
 * - Spotify 429 の Retry-After > 120s で quota 超過とみなして停止
 * - call 間隔 1.5s, タイトル類似度 ≥ 0.7 を採用閾値
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

const FAME_CACHE_PATH = resolve(process.cwd(), "scraper/output/fame_cache.jsonl");
const ALIAS_PATH = resolve(process.cwd(), "scraper/artist_alias.json");
const RESULT_CACHE_PATH = resolve(process.cwd(), "scraper/output/dam_match_cache.jsonl");
const SPOTIFY_INTERVAL_MS = 1500;
const SIMILARITY_THRESHOLD = 0.7;
const MAX_RETRY_AFTER_SEC = 120;
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

interface NullSong {
  id: string;
  title: string;
  artist: string;
}

interface FameEntry {
  fame_score: number;
}

interface MatchResultRecord {
  song_id: string;
  title: string;
  artist: string;
  matched: boolean;
  spotify_track_id?: string;
  spotify_title?: string;
  similarity?: number;
  reason?: string;
}

// --- text utilities (scraper/src/text_match.py の TS 移植版) ---
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/\b(?:feat\.?|featuring|with)\b.*/i, "")
    // 英数 + 日本語以外を除去 (ひらがな・カタカナ・漢字を保持)
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0.0;
  if (na === nb) return 1.0;
  // Levenshtein ベースの ratio (差分文字数 / 最長)
  const dist = levenshtein(na, nb);
  const longer = Math.max(na.length, nb.length);
  return 1 - dist / longer;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
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

// --- Spotify client (Client Credentials) ---
class QuotaExceededError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Spotify quota exceeded (Retry-After=${retryAfterSec}s)`);
  }
}

class SpotifyClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private clientId: string, private clientSecret: string) {}

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(`token endpoint failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in - 60) * 1000;
    return this.token;
  }

  async searchTrack(
    title: string,
    artist: string,
  ): Promise<{ id: string; title: string; artists: string[] }[]> {
    const q = `track:${title} artist:${artist}`;
    const params = new URLSearchParams({ q, type: "track", market: "JP", limit: "5" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.ensureToken();
      const res = await fetch(`${SPOTIFY_SEARCH_URL}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        if (retryAfter > MAX_RETRY_AFTER_SEC) throw new QuotaExceededError(retryAfter);
        console.warn(`spotify: 429, sleeping ${retryAfter}s (attempt ${attempt + 1})`);
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 401) {
        this.token = null;
        continue;
      }
      if (!res.ok) throw new Error(`search failed: ${res.status} ${await res.text()}`);
      const body = (await res.json()) as {
        tracks?: { items?: { id: string; name: string; artists: { name: string }[]; album?: { release_date?: string; images?: { url: string; height?: number }[] } }[] };
      };
      const items = body.tracks?.items ?? [];
      return items.map((item) => ({
        id: item.id,
        title: item.name,
        artists: item.artists.map((a) => a.name),
        // also expose extra fields as any to caller via map below
        ...(item.album ? { release_date: item.album.release_date, images: item.album.images } : {}),
      })) as any;
    }
    throw new Error(`search failed after retries: q=${q}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- main ---
function loadFameScores(): Map<string, number> {
  const map = new Map<string, number>();
  if (!existsSync(FAME_CACHE_PATH)) return map;
  for (const line of readFileSync(FAME_CACHE_PATH, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as FameEntry & { title: string; artist: string };
    if (typeof e.fame_score !== "number") continue;
    map.set(`${e.title}\t${e.artist}`, e.fame_score);
  }
  return map;
}

function loadAliases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!existsSync(ALIAS_PATH)) return map;
  const obj = JSON.parse(readFileSync(ALIAS_PATH, "utf-8")) as Record<string, string[]>;
  for (const [k, v] of Object.entries(obj)) map.set(k, v);
  return map;
}

function loadResumeCache(): Set<string> {
  const set = new Set<string>();
  if (!existsSync(RESULT_CACHE_PATH)) return set;
  for (const line of readFileSync(RESULT_CACHE_PATH, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as MatchResultRecord;
    set.add(e.song_id);
  }
  return set;
}

async function fetchAllNullSongs(): Promise<NullSong[]> {
  const sb = createAdminClient();
  const PAGE = 1000;
  const acc: NullSong[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("songs")
      .select("id, title, artist")
      .is("spotify_track_id", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    acc.push(...data);
    if (data.length < PAGE) break;
  }
  return acc;
}

function pickBest(
  tracks: { id: string; title: string; artists: string[] }[],
  queryTitle: string,
): { track: typeof tracks[number]; sim: number } | null {
  if (tracks.length === 0) return null;
  const scored = tracks.map((t) => ({ track: t, sim: similarity(queryTitle, t.title) }));
  scored.sort((a, b) => (b.sim - a.sim) || (a.track.title.length - b.track.title.length));
  return scored[0];
}

async function main() {
  const args = process.argv.slice(2);
  let maxNew = 300;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--max-new") maxNew = parseInt(args[i + 1] ?? "300", 10);
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");
    process.exit(1);
  }

  const fame = loadFameScores();
  const aliases = loadAliases();
  const resumeCache = loadResumeCache();
  console.log(`fame entries: ${fame.size}, aliases: ${aliases.size}, resume: ${resumeCache.size} already processed`);

  const nullSongs = await fetchAllNullSongs();
  console.log(`DB null songs: ${nullSongs.length}`);

  const candidates = nullSongs
    .filter((s) => fame.has(`${s.title}\t${s.artist}`))
    .filter((s) => !resumeCache.has(s.id))
    .map((s) => ({ ...s, fame: fame.get(`${s.title}\t${s.artist}`)! }));
  candidates.sort((a, b) => b.fame - a.fame);
  console.log(`candidates (fame既知 ∩ 未処理): ${candidates.length}`);

  const targets = candidates.slice(0, maxNew);
  console.log(`processing top ${targets.length} (--max-new=${maxNew})`);
  if (targets.length === 0) {
    console.log("nothing to do.");
    return;
  }

  const client = new SpotifyClient(clientId, clientSecret);
  const sb = createAdminClient();
  let matched = 0;
  let unmatched = 0;
  let quotaHit = false;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const aliasList = aliases.get(t.artist) ?? [t.artist];
    let result: MatchResultRecord = {
      song_id: t.id,
      title: t.title,
      artist: t.artist,
      matched: false,
      reason: "no_spotify_hit",
    };
    let bestRaw: any = null;
    let bestSim = 0;

    try {
      for (const alias of aliasList) {
        const tracks = await client.searchTrack(t.title, alias);
        const best = pickBest(tracks as any, t.title);
        if (best && best.sim >= SIMILARITY_THRESHOLD && best.sim > bestSim) {
          bestRaw = best.track;
          bestSim = best.sim;
        }
        if (bestSim >= 0.95) break; // 充分高ければ追加 alias 検索しない
        await sleep(SPOTIFY_INTERVAL_MS);
      }
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.error(`spotify quota exceeded at ${i}/${targets.length} (retry_after=${e.retryAfterSec}s); stopping`);
        quotaHit = true;
        break;
      }
      throw e;
    }

    if (bestRaw && bestSim >= SIMILARITY_THRESHOLD) {
      // searchTrack() は album.images / album.release_date をトップレベルに展開して返す
      const images = (bestRaw.images ?? []) as { url: string; height?: number }[];
      const sortedImgs = [...images].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
      const large = sortedImgs.find((i) => (i.height ?? 0) >= 500) ?? sortedImgs[0];
      const medium = sortedImgs.find((i) => (i.height ?? 0) >= 200 && (i.height ?? 0) < 500) ?? sortedImgs[Math.floor(sortedImgs.length / 2)];
      const small = [...sortedImgs].reverse().find((i) => (i.height ?? 0) <= 200) ?? sortedImgs[sortedImgs.length - 1];
      const releaseYear = bestRaw.release_date ? parseInt(bestRaw.release_date.slice(0, 4), 10) : null;

      const { error } = await sb
        .from("songs")
        .update({
          spotify_track_id: bestRaw.id,
          image_url_large: large?.url ?? null,
          image_url_medium: medium?.url ?? null,
          image_url_small: small?.url ?? null,
          release_year: Number.isFinite(releaseYear) ? releaseYear : null,
          is_popular: true,
        })
        .eq("id", t.id);
      if (error) {
        // unique constraint 等。失敗を記録して継続
        result = { ...result, matched: false, reason: `db_update_failed: ${error.message}` };
        unmatched++;
      } else {
        result = {
          song_id: t.id,
          title: t.title,
          artist: t.artist,
          matched: true,
          spotify_track_id: bestRaw.id,
          spotify_title: bestRaw.title,
          similarity: bestSim,
        };
        matched++;
      }
    } else {
      unmatched++;
    }

    appendFileSync(RESULT_CACHE_PATH, JSON.stringify(result) + "\n", "utf-8");

    if ((i + 1) % 25 === 0) {
      console.log(`  progress: ${i + 1}/${targets.length} (matched=${matched}, unmatched=${unmatched})`);
    }
    await sleep(SPOTIFY_INTERVAL_MS);
  }

  console.log(`\ndone. matched=${matched}, unmatched=${unmatched}, quota_hit=${quotaHit}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

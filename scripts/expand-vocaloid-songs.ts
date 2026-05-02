/**
 * 既存の vocaloid_utaite アーティストの Spotify トップトラックを取得し、
 * songs テーブルにまだ無い楽曲を新規 INSERT する。
 *
 * 目的:
 *   現状ボカロ・歌い手アーティスト 29 組のうち多くが 1〜3 曲しか登録されていない。
 *   Spotify の「アーティストのトップトラック」を補充して代表曲カバレッジを上げる。
 *
 * 実行:
 *   pnpm expand:vocaloid                # 既定: 全 vocaloid_utaite アーティスト
 *   pnpm expand:vocaloid -- --limit 5   # 先頭 5 アーティストだけ (テスト用)
 *   pnpm expand:vocaloid -- --dry-run   # 書き込まずに件数のみ表示
 *
 * 仕様:
 *   - Spotify Client Credentials のみで動作 (Spotify Web API は 2024/11 以降
 *     /v1/artists/{id}/top-tracks や /v1/search?q=artist:... が制限されたため、
 *     `q=<artist>&type=track` をページング (offset 0,10,20) して取得し、primary
 *     artist が一致するものを採用するアプローチ)
 *   - 名前正規化 (NFKC + lowercase) で類似度判定 (≥ 0.8)
 *   - 既に同じ spotify_track_id を持つ songs 行があればスキップ (insert は冪等)
 *   - 同一アーティストの同タイトル (例: ライブ版 / リミックス) は最初の 1 件のみ採用
 *   - 新規行は match_status='matched', is_popular=true, artist_id を埋める
 *   - 音域 (range_*_midi) は null のまま (別ソースで埋める想定)
 *   - rate limit: 1.5s 間隔, 429 で Retry-After>120s なら停止
 *   - 結果は scraper/output/expand_vocaloid_cache.jsonl に append (resume 用)
 */
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];

const ALIAS_PATH = resolve(process.cwd(), "scraper/artist_alias.json");
const RESULT_CACHE_PATH = resolve(
  process.cwd(),
  "scraper/output/expand_vocaloid_cache.jsonl",
);
const SPOTIFY_INTERVAL_MS = 1500;
const ARTIST_SIM_THRESHOLD = 0.8;
const MAX_RETRY_AFTER_SEC = 120;
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";
const SPOTIFY_ARTIST_TOP_URL = "https://api.spotify.com/v1/artists";

// ----------------------------------------------------------------------------
// text utilities
// ----------------------------------------------------------------------------
function normalize(s: string): string {
  return s
    .normalize("NFKC")
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
  if (!na || !nb) return 0.0;
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) {
    const longer = Math.max(na.length, nb.length);
    const shorter = Math.min(na.length, nb.length);
    return shorter / longer;
  }
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

function stripParenthetical(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/\b(?:feat\.?|featuring|with)\b.*$/i, "")
    .trim();
}

// ----------------------------------------------------------------------------
// Spotify client
// ----------------------------------------------------------------------------
class QuotaExceededError extends Error {
  constructor(public retryAfterSec: number) {
    super(`Spotify quota exceeded (Retry-After=${retryAfterSec}s)`);
  }
}

interface SpotifyImage {
  url: string;
  height?: number;
}
interface SpotifyArtist {
  id: string;
  name: string;
  images?: SpotifyImage[];
  popularity?: number;
}
interface SpotifyTrack {
  id: string;
  name: string;
  artists: { name: string }[];
  album?: {
    release_date?: string;
    images?: SpotifyImage[];
  };
}

class SpotifyClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private clientId: string, private clientSecret: string) {}

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      "base64",
    );
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      throw new Error(
        `token endpoint failed: ${res.status} ${await res.text()}`,
      );
    }
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.token = body.access_token;
    this.tokenExpiresAt = Date.now() + (body.expires_in - 60) * 1000;
    return this.token;
  }

  private async getJSON(url: string): Promise<any> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.ensureToken();
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("Retry-After") ?? "2", 10);
        if (retryAfter > MAX_RETRY_AFTER_SEC)
          throw new QuotaExceededError(retryAfter);
        console.warn(
          `spotify: 429, sleeping ${retryAfter}s (attempt ${attempt + 1})`,
        );
        await sleep(retryAfter * 1000);
        continue;
      }
      if (res.status === 401) {
        this.token = null;
        continue;
      }
      if (!res.ok) {
        throw new Error(`request failed: ${res.status} ${await res.text()}`);
      }
      return res.json();
    }
    throw new Error(`request failed after retries: ${url}`);
  }

  async searchTracks(
    query: string,
    offset: number,
  ): Promise<SpotifyTrack[]> {
    const params = new URLSearchParams({
      q: query,
      type: "track",
      market: "JP",
      limit: "10",
      offset: String(offset),
    });
    const body = await this.getJSON(`${SPOTIFY_SEARCH_URL}?${params}`);
    return (body.tracks?.items ?? []) as SpotifyTrack[];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------
function loadAliases(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  if (!existsSync(ALIAS_PATH)) return map;
  const obj = JSON.parse(readFileSync(ALIAS_PATH, "utf-8")) as Record<
    string,
    string[]
  >;
  for (const [k, v] of Object.entries(obj)) map.set(k, v);
  return map;
}

function loadResumeCache(): Set<string> {
  // 1行 1 spotify_track_id (already inserted or already-existed)
  const set = new Set<string>();
  if (!existsSync(RESULT_CACHE_PATH)) return set;
  for (const line of readFileSync(RESULT_CACHE_PATH, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line) as { spotify_track_id?: string };
    if (e.spotify_track_id) set.add(e.spotify_track_id);
  }
  return set;
}

function pickImages(images: SpotifyImage[] | undefined): {
  large: string | null;
  medium: string | null;
  small: string | null;
} {
  if (!images || images.length === 0)
    return { large: null, medium: null, small: null };
  const sorted = [...images].sort(
    (a, b) => (b.height ?? 0) - (a.height ?? 0),
  );
  const large =
    sorted.find((i) => (i.height ?? 0) >= 500)?.url ?? sorted[0].url;
  const medium =
    sorted.find((i) => (i.height ?? 0) >= 200 && (i.height ?? 0) < 500)?.url ??
    sorted[Math.floor(sorted.length / 2)].url;
  const small =
    [...sorted].reverse().find((i) => (i.height ?? 0) <= 200)?.url ??
    sorted[sorted.length - 1].url;
  return { large, medium, small };
}

// ----------------------------------------------------------------------------
// main
// ----------------------------------------------------------------------------
interface ResultRecord {
  artist_id: string;
  artist_name: string;
  spotify_track_id?: string;
  title?: string;
  action:
    | "inserted"
    | "skipped_existing"
    | "skipped_other_artist"
    | "skipped_dup_title"
    | "no_tracks_found"
    | "error";
  reason?: string;
}

async function main() {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit") limit = parseInt(args[i + 1] ?? "0", 10);
    if (args[i] === "--dry-run") dryRun = true;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");
    process.exit(1);
  }

  const sb = createAdminClient() as any;
  const aliases = loadAliases();
  const resumeCache = loadResumeCache();

  const { data: artists, error: e1 } = await sb
    .from("artists_with_song_count")
    .select("id, name, song_count, genres")
    .contains("genres", ["vocaloid_utaite"])
    .order("song_count", { ascending: false });
  if (e1) throw e1;

  let targets: { id: string; name: string; song_count: number }[] = artists ?? [];
  if (limit && limit > 0) targets = targets.slice(0, limit);

  console.log(
    `target vocaloid artists: ${targets.length}${dryRun ? " (dry-run)" : ""}`,
  );
  console.log(`resume cache: ${resumeCache.size} tracks already processed`);

  // 既存の全 spotify_track_id を取得 (重複 INSERT 回避)
  const existingTrackIds = new Set<string>();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("songs")
        .select("spotify_track_id")
        .not("spotify_track_id", "is", null)
        .order("spotify_track_id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) existingTrackIds.add(r.spotify_track_id);
      if (data.length < PAGE) break;
    }
  }
  console.log(`existing tracks in DB: ${existingTrackIds.size}`);

  const client = new SpotifyClient(clientId, clientSecret);
  let totalInserted = 0;
  let totalSkipped = 0;
  let quotaHit = false;

  const PAGES = 3; // offset 0, 10, 20 → 最大 30 件取得 (Spotify 側の総数次第)

  for (let ai = 0; ai < targets.length; ai++) {
    const a = targets[ai];
    const stripped = stripParenthetical(a.name) || a.name;
    // alias は「クエリ」かつ「primary artist 一致判定」の両方で使う
    const aliasNames = [
      a.name,
      stripped,
      ...(aliases.get(a.name) ?? []),
    ];
    const uniqueAliases = Array.from(new Set(aliasNames.filter(Boolean)));
    // クエリは alias から (重複は new Set で吸収済み)
    const uniqueQueries = uniqueAliases;

    // クエリ × ページを全部叩いてトラック候補を集約
    const candidateMap = new Map<string, SpotifyTrack>();
    let pageError = false;
    try {
      for (const q of uniqueQueries) {
        for (let p = 0; p < PAGES; p++) {
          const tracks = await client.searchTracks(q, p * 10);
          for (const t of tracks) {
            if (!candidateMap.has(t.id)) candidateMap.set(t.id, t);
          }
          await sleep(SPOTIFY_INTERVAL_MS);
          // Spotify 側で「全件返した」場合 (next が無い) はそれ以上 offset を進めても無駄。
          // ただ search レスポンスの構造を見るための next フラグは getJSON で破棄しているので、
          // 簡易判定として「返却件数 < 10」なら以降スキップ。
          if (tracks.length < 10) break;
        }
      }
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        console.error(
          `quota exceeded at artist ${ai}/${targets.length}; stopping`,
        );
        quotaHit = true;
        pageError = true;
        break;
      }
      throw err;
    }
    if (pageError) break;

    if (candidateMap.size === 0) {
      console.log(`  [${ai + 1}/${targets.length}] ${a.name} → 0 hits`);
      appendFileSync(
        RESULT_CACHE_PATH,
        JSON.stringify({
          artist_id: a.id,
          artist_name: a.name,
          action: "no_tracks_found",
        } satisfies ResultRecord) + "\n",
      );
      continue;
    }

    let inserted = 0;
    let skippedExisting = 0;
    let skippedOther = 0;
    let skippedDupTitle = 0;
    const seenTitles = new Set<string>();
    for (const t of candidateMap.values()) {
      const primaryName = t.artists[0]?.name ?? "";
      // alias リストのいずれかと類似していればOK
      const sim = Math.max(
        ...uniqueAliases.map((al) => similarity(al, primaryName)),
      );
      if (sim < ARTIST_SIM_THRESHOLD) {
        skippedOther++;
        appendFileSync(
          RESULT_CACHE_PATH,
          JSON.stringify({
            artist_id: a.id,
            artist_name: a.name,
            spotify_track_id: t.id,
            title: t.name,
            action: "skipped_other_artist",
            reason: `primary=${primaryName}`,
          } satisfies ResultRecord) + "\n",
        );
        continue;
      }
      if (existingTrackIds.has(t.id)) {
        skippedExisting++;
        appendFileSync(
          RESULT_CACHE_PATH,
          JSON.stringify({
            artist_id: a.id,
            artist_name: a.name,
            spotify_track_id: t.id,
            title: t.name,
            action: "skipped_existing",
          } satisfies ResultRecord) + "\n",
        );
        continue;
      }
      const titleKey = normalize(t.name);
      if (seenTitles.has(titleKey)) {
        skippedDupTitle++;
        appendFileSync(
          RESULT_CACHE_PATH,
          JSON.stringify({
            artist_id: a.id,
            artist_name: a.name,
            spotify_track_id: t.id,
            title: t.name,
            action: "skipped_dup_title",
          } satisfies ResultRecord) + "\n",
        );
        continue;
      }
      seenTitles.add(titleKey);

      const imgs = pickImages(t.album?.images);
      const releaseYear = t.album?.release_date
        ? parseInt(t.album.release_date.slice(0, 4), 10)
        : null;
      const row: SongInsert = {
        title: t.name,
        artist: a.name,
        artist_id: a.id,
        release_year: Number.isFinite(releaseYear) ? releaseYear : null,
        spotify_track_id: t.id,
        image_url_large: imgs.large,
        image_url_medium: imgs.medium,
        image_url_small: imgs.small,
        is_popular: true,
        match_status: "matched",
        source_urls: [`https://open.spotify.com/track/${t.id}`],
      };
      if (dryRun) {
        inserted++;
        existingTrackIds.add(t.id);
        appendFileSync(
          RESULT_CACHE_PATH,
          JSON.stringify({
            artist_id: a.id,
            artist_name: a.name,
            spotify_track_id: t.id,
            title: t.name,
            action: "inserted",
            reason: "dry-run",
          } satisfies ResultRecord) + "\n",
        );
        continue;
      }
      const { error: upErr } = await sb.from("songs").insert(row);
      if (upErr) {
        console.error(
          `    ✗ insert failed for ${t.name} / ${a.name}: ${upErr.message}`,
        );
        appendFileSync(
          RESULT_CACHE_PATH,
          JSON.stringify({
            artist_id: a.id,
            artist_name: a.name,
            spotify_track_id: t.id,
            title: t.name,
            action: "error",
            reason: upErr.message,
          } satisfies ResultRecord) + "\n",
        );
        continue;
      }
      inserted++;
      existingTrackIds.add(t.id);
      appendFileSync(
        RESULT_CACHE_PATH,
        JSON.stringify({
          artist_id: a.id,
          artist_name: a.name,
          spotify_track_id: t.id,
          title: t.name,
          action: "inserted",
        } satisfies ResultRecord) + "\n",
      );
    }
    totalInserted += inserted;
    totalSkipped += skippedExisting + skippedOther + skippedDupTitle;
    console.log(
      `  [${ai + 1}/${targets.length}] ${a.name} (DB ${a.song_count}曲) | hits=${candidateMap.size} | +${inserted} inserted (existing=${skippedExisting}, other=${skippedOther}, dup=${skippedDupTitle})`,
    );
  }

  console.log(
    `\n=== 完了 ===\ninserted: ${totalInserted}\nskipped:  ${totalSkipped}\nquota_hit: ${quotaHit}${dryRun ? "\n(DRY RUN: 実際の書き込みはしていません)" : ""}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

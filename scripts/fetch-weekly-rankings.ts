/**
 * 週次ランキング取得・集計スクリプト。
 *
 * ソース:
 *   - Apple Music Top 100 JP (Marketing Tools RSS, 無認証)
 *
 * 処理フロー:
 *   1. Apple Music Top 100 RSS を取得
 *   2. 各 Apple トラックを既存 songs と (title+artist 正規化) でマッチ
 *   3. 未マッチは Spotify search で track を解決し ISRC/ID で再マッチ →
 *      無ければ新規 INSERT (画像・メタフル付与)
 *   4. 正規化 Borda スコアを採番し weekly_rankings に upsert
 *      (week_start = 今週月曜 UTC)
 *
 * 設計メモ:
 *   - 当初は Spotify "Top 50 - Japan" editorial playlist も併用していたが、
 *     2024 後半に Spotify が新規 app の /v1/playlists を 403/404 で遮断
 *     (project_spotify_playlist_blocked.md)。Top 50 取得は恒久的に不能の
 *     ため該当コードを削除し Apple Music RSS 一本化した (2026-05-15)。
 *   - Spotify search (/v1/search) は引き続き 200 なので、Apple トラックの
 *     Spotify ID 解決・新規 INSERT のエンリッチには使用する。
 *   - Apple RSS は ISRC を持たないため title+artist の正規化マッチに依存。
 *
 * 使い方:
 *   pnpm fetch:weekly-rankings --dry-run
 *   pnpm fetch:weekly-rankings
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type ArtistInsert = Database["public"]["Tables"]["artists"]["Insert"];
type WeeklyRankingInsert =
  Database["public"]["Tables"]["weekly_rankings"]["Insert"];

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

// Apple Music の Marketing Tools RSS (JP 国コード)。サインインや API key 不要。
// 100 件取得 = .../most-played/100/songs.json
const APPLE_TOP100_JP_RSS =
  "https://rss.applemarketingtools.com/api/v2/jp/music/most-played/100/songs.json";

const INTERVAL_MS = 1500;
const MAX_RETRY_AFTER_SEC = 120;
const MIN_TITLE_SIM = 0.8;
const MIN_ARTIST_SIM = 0.4;

// --- text utilities --------------------------------------------------------

function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function normalizeArtistName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
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

function similarity(a: string, b: string, normalize: (s: string) => string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs(): { dryRun: boolean } {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

/**
 * 今週の月曜 (UTC) を YYYY-MM-DD で返す。
 * ISO 8601 では月曜が週の起点。週次のスナップショット key として使う。
 */
function isoWeekMondayUtc(now = new Date()): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Mon=1.
  const dow = d.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

// --- Spotify ---------------------------------------------------------------

class QuotaExceededError extends Error {
  constructor(public retryAfter: number) {
    super(`spotify quota (Retry-After=${retryAfter}s)`);
  }
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    release_date?: string;
    images?: Array<{ url: string; width: number; height: number }>;
  };
  duration_ms: number;
  popularity?: number;
  preview_url: string | null;
  explicit: boolean;
  external_ids?: { isrc?: string };
}

async function getSpotifyToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("missing SPOTIFY_CLIENT_ID/SECRET");
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization:
        "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function spotifyGet(token: string, url: URL): Promise<Response> {
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const ra = parseInt(res.headers.get("Retry-After") ?? "0", 10);
    if (ra > MAX_RETRY_AFTER_SEC) throw new QuotaExceededError(ra);
    await sleep(ra * 1000);
    return spotifyGet(token, url);
  }
  return res;
}

async function searchSpotify(
  token: string,
  title: string,
  artist: string,
): Promise<SpotifyTrack[]> {
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set("q", `${title} ${artist}`);
  url.searchParams.set("type", "track");
  url.searchParams.set("market", "JP");
  url.searchParams.set("limit", "10");
  const res = await spotifyGet(token, url);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = (await res.json()) as { tracks?: { items: SpotifyTrack[] } };
  return json.tracks?.items ?? [];
}

function pickBestMatch(
  wantedTitle: string,
  wantedArtist: string,
  candidates: SpotifyTrack[],
): { track: SpotifyTrack; titleSim: number; artistSim: number } | null {
  let best:
    | { track: SpotifyTrack; titleSim: number; artistSim: number }
    | null = null;
  for (const t of candidates) {
    const ts = similarity(wantedTitle, t.name, normalizeTitle);
    if (ts < MIN_TITLE_SIM) continue;
    let aMaxSim = 0;
    for (const candArtist of t.artists) {
      const s = similarity(wantedArtist, candArtist.name, normalizeArtistName);
      if (s > aMaxSim) aMaxSim = s;
    }
    if (aMaxSim < MIN_ARTIST_SIM) continue;
    const score = ts * 0.6 + aMaxSim * 0.4;
    const bestScore = best ? best.titleSim * 0.6 + best.artistSim * 0.4 : -1;
    if (score > bestScore) {
      best = { track: t, titleSim: ts, artistSim: aMaxSim };
    }
  }
  return best;
}

// --- Apple Music -----------------------------------------------------------

interface AppleRssEntry {
  id: string;
  name: string;
  artistName: string;
  artworkUrl100?: string;
  releaseDate?: string;
  url?: string;
}

async function fetchAppleTop100(): Promise<
  Array<{ rank: number; entry: AppleRssEntry }>
> {
  const res = await fetch(APPLE_TOP100_JP_RSS);
  if (!res.ok) {
    console.warn(`[apple] RSS fetch failed: ${res.status}`);
    return [];
  }
  const json = (await res.json()) as {
    feed?: { results?: AppleRssEntry[] };
  };
  const results = json.feed?.results ?? [];
  return results.map((entry, i) => ({ rank: i + 1, entry }));
}

// --- 集計 & DB upsert ------------------------------------------------------

/**
 * 1 曲がランキング上に占める情報。song_id が決まったら sources にスコアを足していく。
 */
interface RankedSongBucket {
  songId: string;
  // ソース別の順位。null なら未登場。
  // 現状 Apple のみ。将来 Spotify Top50 を別経路で復活させる場合に備え
  // sources は拡張可能な形のまま残す。
  sources: { apple?: number };
}

/**
 * 正規化 Borda スコア:
 *   apple (100件) → (101 - rank) / 100  (最大寄与 1.0)
 */
function computeScore(sources: RankedSongBucket["sources"]): number {
  let s = 0;
  if (sources.apple) s += (101 - sources.apple) / 100;
  return s;
}

/** songs テーブルから (spotify_track_id, isrc, title_norm+artist_norm) 索引を作る */
async function buildSongIndex(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{
  bySpotifyId: Map<string, string>;
  byIsrc: Map<string, string>;
  byNormKey: Map<string, string>;
}> {
  const bySpotifyId = new Map<string, string>();
  const byIsrc = new Map<string, string>();
  const byNormKey = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, spotify_track_id, spotify_isrc")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.spotify_track_id) bySpotifyId.set(r.spotify_track_id, r.id);
      if (r.spotify_isrc) byIsrc.set(r.spotify_isrc, r.id);
      const k =
        normalizeArtistName(r.artist ?? "") + "|" + normalizeTitle(r.title);
      if (!byNormKey.has(k)) byNormKey.set(k, r.id);
    }
    if (data.length < PAGE) break;
  }
  return { bySpotifyId, byIsrc, byNormKey };
}

/**
 * songs に該当が無い Spotify track を新規 INSERT し、song_id を返す。
 * artists が存在しなければ最低限の行を作って link する。
 */
async function insertSongFromSpotify(
  supabase: ReturnType<typeof createAdminClient>,
  track: SpotifyTrack,
  artistByNorm: Map<string, string>,
): Promise<string | null> {
  const title = track.name;
  const artistName = track.artists[0]?.name ?? "";
  const aKey = normalizeArtistName(artistName);

  let artistId = artistByNorm.get(aKey);
  if (!artistId) {
    const ins: ArtistInsert = {
      name: artistName || "(unknown)",
      name_norm: aKey || normalizeArtistName(artistName || "unknown"),
      genres: [],
    };
    const { data, error } = await supabase
      .from("artists")
      .insert(ins)
      .select("id")
      .single();
    if (error) {
      console.warn(`  [WARN-ARTIST] ${artistName}: ${error.message}`);
      return null;
    }
    artistId = data.id;
    artistByNorm.set(aKey, artistId);
  }

  const album = track.album;
  const artworkLarge = album.images?.[0]?.url ?? null;
  const artworkMedium = album.images?.[1]?.url ?? artworkLarge;
  const artworkSmall = album.images?.[2]?.url ?? artworkMedium;
  const releaseYear = album.release_date
    ? parseInt(album.release_date.slice(0, 4), 10)
    : null;

  const songRow: SongInsert = {
    title,
    artist: artistName,
    artist_id: artistId,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    image_url_large: artworkLarge,
    image_url_medium: artworkMedium,
    image_url_small: artworkSmall,
    duration_ms: track.duration_ms,
    spotify_track_id: track.id,
    spotify_popularity: track.popularity ?? null,
    spotify_preview_url: track.preview_url,
    spotify_explicit: track.explicit,
    spotify_isrc: track.external_ids?.isrc ?? null,
    is_popular: true,
    source_urls: [`https://open.spotify.com/track/${track.id}`],
  };
  const { data, error } = await supabase
    .from("songs")
    .insert(songRow)
    .select("id")
    .single();
  if (error) {
    console.warn(`  [WARN-INSERT-SONG] ${artistName} | ${title}: ${error.message}`);
    return null;
  }
  return data.id;
}

async function loadArtistIndex(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, name, name_norm")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const a of data) {
      const k1 = normalizeArtistName(a.name);
      if (!out.has(k1)) out.set(k1, a.id);
      if (a.name_norm && !out.has(a.name_norm)) out.set(a.name_norm, a.id);
    }
    if (data.length < PAGE) break;
  }
  return out;
}

// --- main ------------------------------------------------------------------

async function main() {
  const { dryRun } = parseArgs();
  const weekStart = isoWeekMondayUtc();
  console.log(`week_start=${weekStart}, dryRun=${dryRun}`);

  const supabase = createAdminClient();
  console.log("loading songs/artists index...");
  const [songIdx, artistByNorm] = await Promise.all([
    buildSongIndex(supabase),
    loadArtistIndex(supabase),
  ]);
  console.log(
    `  songs: ${songIdx.bySpotifyId.size} by spotify_id, ${songIdx.byIsrc.size} by isrc, ${songIdx.byNormKey.size} by norm`,
  );
  console.log(`  artists: ${artistByNorm.size}`);

  const token = await getSpotifyToken();

  // --- 1. Apple Top 100 ----------------------------------------------------
  const appleItems = await fetchAppleTop100();
  console.log(`apple top100: fetched ${appleItems.length}`);

  if (appleItems.length === 0) {
    console.error("Apple RSS 取得失敗。終了。");
    process.exit(1);
  }

  // --- 3. song_id への解決 + 新規取り込み ---------------------------------
  const buckets = new Map<string, RankedSongBucket>();

  const ensureBucket = (songId: string) => {
    let b = buckets.get(songId);
    if (!b) {
      b = { songId, sources: {} };
      buckets.set(songId, b);
    }
    return b;
  };

  for (const { rank, entry } of appleItems) {
    // 既存マッチをまず試す (Spotify を呼ばずに済むなら省略)
    const normKey =
      normalizeArtistName(entry.artistName) + "|" + normalizeTitle(entry.name);
    let songId = songIdx.byNormKey.get(normKey);

    if (!songId) {
      // Spotify search で track ID を解決し、その後 ISRC でもマッチ試行 → 無ければ INSERT
      let candidates: SpotifyTrack[] = [];
      try {
        candidates = await searchSpotify(token, entry.name, entry.artistName);
        await sleep(INTERVAL_MS);
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          console.warn(`  [QUOTA] apple search 中止 rank=${rank}`);
          break;
        }
        console.warn(`  [WARN-SEARCH] apple rank=${rank}: ${(e as Error).message}`);
      }
      const match = pickBestMatch(entry.name, entry.artistName, candidates);
      if (match) {
        const tr = match.track;
        songId =
          songIdx.bySpotifyId.get(tr.id) ??
          (tr.external_ids?.isrc
            ? songIdx.byIsrc.get(tr.external_ids.isrc)
            : undefined);
        if (!songId) {
          if (dryRun) {
            console.log(
              `  [DRY-NEW-AP] rank=${rank} ${entry.artistName} | ${entry.name}`,
            );
          } else {
            const newId = await insertSongFromSpotify(
              supabase,
              tr,
              artistByNorm,
            );
            if (newId) {
              songId = newId;
              songIdx.bySpotifyId.set(tr.id, newId);
              if (tr.external_ids?.isrc)
                songIdx.byIsrc.set(tr.external_ids.isrc, newId);
              songIdx.byNormKey.set(normKey, newId);
            }
          }
        }
      } else {
        console.log(
          `  [NOMATCH-AP] rank=${rank} ${entry.artistName} | ${entry.name}`,
        );
      }
    }
    if (songId) {
      ensureBucket(songId).sources.apple = rank;
    }
  }

  console.log(`resolved buckets: ${buckets.size}`);

  // --- 4. スコア合算 + final_rank 採番 -----------------------------------
  const ranked = Array.from(buckets.values())
    .map((b) => ({ ...b, score: computeScore(b.sources) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // tie-breaker: Apple 順位
      const aRank = a.sources.apple ?? 9999;
      const bRank = b.sources.apple ?? 9999;
      return aRank - bRank;
    });

  const rows: WeeklyRankingInsert[] = ranked.map((r, i) => ({
    week_start: weekStart,
    song_id: r.songId,
    final_rank: i + 1,
    score: r.score,
    sources: r.sources,
  }));

  if (dryRun) {
    console.log("--- TOP 20 (dry-run) ---");
    for (const row of rows.slice(0, 20)) {
      console.log(
        `  ${row.final_rank}. score=${(row.score as number).toFixed(2)} sources=${JSON.stringify(row.sources)} song_id=${row.song_id}`,
      );
    }
    console.log(`total=${rows.length}`);
    return;
  }

  // --- 5. upsert ----------------------------------------------------------
  // 既存 week_start を全削除 → INSERT (簡潔さ優先、行数 ~150 なので問題なし)
  const { error: delErr } = await supabase
    .from("weekly_rankings")
    .delete()
    .eq("week_start", weekStart);
  if (delErr) {
    console.error(`delete failed: ${delErr.message}`);
    process.exit(1);
  }
  // バッチ INSERT (Supabase は 1000 行まで一括 OK)
  const { error: insErr } = await supabase
    .from("weekly_rankings")
    .insert(rows);
  if (insErr) {
    console.error(`insert failed: ${insErr.message}`);
    process.exit(1);
  }
  console.log(`upserted ${rows.length} rows for week_start=${weekStart}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

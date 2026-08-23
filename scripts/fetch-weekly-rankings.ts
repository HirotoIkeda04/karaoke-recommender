/**
 * 週次ランキング取得・集計スクリプト。
 *
 * ソース:
 *   - Apple Music Top 100 JP (Marketing Tools RSS, 無認証)
 *
 * 処理フロー:
 *   1. Apple Music Top 100 RSS を取得
 *   2. RSS の id (= iTunes trackId) を iTunes lookup で一括解決し、
 *      itunes_track_id → 正規化 title+artist の順に既存 songs とマッチ
 *   3. それでも未マッチのものだけ Spotify search で解決 →
 *      無ければ新規 INSERT (画像・メタフル付与)
 *   4. 正規化 Borda スコアを採番し weekly_rankings に upsert
 *      (week_start = 今週月曜 UTC)
 *
 * 設計メモ:
 *   - 当初は Spotify "Top 50 - Japan" editorial playlist も併用していたが、
 *     2024 後半に Spotify が新規 app の /v1/playlists を 403/404 で遮断
 *     (project_spotify_playlist_blocked.md)。Top 50 取得は恒久的に不能の
 *     ため該当コードを削除し Apple Music RSS 一本化した (2026-05-15)。
 *   - Spotify search (/v1/search) は引き続き 200 なので、iTunes でも既存曲に
 *     結び付かなかった曲の新規 INSERT (spotify_track_id の採取) にだけ使う。
 *   - Apple RSS は ISRC を持たないが id (= iTunes trackId) を持つ。以前は
 *     これを捨てて Spotify search の曖昧マッチに頼っており、週 ~100 call を
 *     消費した上に MIN_TITLE_SIM を割った曲がチャートから脱落していた。
 *     iTunes lookup なら id で完全一致し、100 曲を 1 リクエストで解決できる
 *     (2026-08-16 に切替)。previewUrl も同時に取れるので、ホームの試聴用
 *     itunes_preview_url をチャート取り込みと同時に埋められる。
 *
 * 使い方:
 *   pnpm fetch:weekly-rankings --dry-run
 *   pnpm fetch:weekly-rankings
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];
type ArtistInsert = Database["public"]["Tables"]["artists"]["Insert"];
type WeeklyRankingInsert =
  Database["public"]["Tables"]["weekly_rankings"]["Insert"];

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";

// Apple Music の Marketing Tools RSS (JP 国コード)。サインインや API key 不要。
// 100 件取得 = .../most-played/100/songs.json
const APPLE_TOP100_JP_RSS =
  "https://rss.applemarketingtools.com/api/v2/jp/music/most-played/100/songs.json";

// iTunes lookup。RSS の id をカンマ区切りで一括指定できる (認証不要)。
const ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup";
const ITUNES_LOOKUP_CHUNK = 50;
const ITUNES_USER_AGENT =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const INTERVAL_MS = 1500;
const MAX_RETRY_AFTER_SEC = 120;
const MIN_TITLE_SIM = 0.8;
const MIN_ARTIST_SIM = 0.4;

// --- text utilities --------------------------------------------------------

/**
 * 共演者の羅列から主たるアーティストだけを取り出す。
 * Apple RSS は "EBiDAN, 超特急, M!LK & 原因は自分にある。" のように共演者を
 * 全部並べるため、DB 側の主アーティスト表記と normKey が一致しない。
 */
function primaryArtistName(s: string): string {
  // 括弧内に読点を含む表記 ("A (feat. B, C)") で切り損ねないよう先に括弧を落とす
  const flat = s.replace(/[（(][^）)]*[）)]/g, " ");
  return (flat.split(/\s*(?:,|、|&|＆|feat\.|ft\.|with)\s*/i)[0] ?? flat).trim();
}

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

// --- iTunes lookup ---------------------------------------------------------

interface ItunesTrack {
  trackId: number;
  trackName: string;
  artistName: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  previewUrl?: string;
  trackViewUrl?: string;
}

/** `100x100bb.jpg` → `600x600bb.jpg` のようにサイズ部分だけ差し替える */
function resizeArtwork(url: string, size: number): string {
  return url.replace(/\d+x\d+bb\.(jpg|png)/i, `${size}x${size}bb.$1`);
}

/**
 * Apple RSS の id (= iTunes trackId) を lookup で一括解決する。
 * 失敗しても致命的ではない (呼び出し側が従来の Spotify 経路にフォールバック
 * する) ので、例外は投げず取れた分だけ返す。
 */
async function fetchItunesLookup(
  ids: string[],
): Promise<Map<string, ItunesTrack>> {
  const out = new Map<string, ItunesTrack>();
  for (let i = 0; i < ids.length; i += ITUNES_LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + ITUNES_LOOKUP_CHUNK);
    const url = new URL(ITUNES_LOOKUP_URL);
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("country", "jp");
    url.searchParams.set("entity", "song");
    try {
      const res = await fetch(url.toString(), {
        headers: { "User-Agent": ITUNES_USER_AGENT },
      });
      if (!res.ok) {
        console.warn(`[itunes] lookup failed: ${res.status} (chunk ${i})`);
        continue;
      }
      const json = (await res.json()) as { results?: ItunesTrack[] };
      for (const r of json.results ?? []) {
        if (r.trackId) out.set(String(r.trackId), r);
      }
    } catch (e) {
      console.warn(`[itunes] lookup error (chunk ${i}): ${(e as Error).message}`);
    }
    if (i + ITUNES_LOOKUP_CHUNK < ids.length) await sleep(INTERVAL_MS);
  }
  return out;
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

/**
 * songs テーブルから (itunes_track_id, spotify_track_id, isrc,
 * title_norm+artist_norm) 索引を作る。
 * needsItunesFill は itunes_preview_url が未設定の song_id 集合で、
 * チャート解決のついでにプレビュー URL を埋める対象になる。
 */
async function buildSongIndex(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<{
  byItunesId: Map<string, string>;
  bySpotifyId: Map<string, string>;
  byIsrc: Map<string, string>;
  byNormKey: Map<string, string>;
  byPrimaryKey: Map<string, string>;
  needsItunesFill: Set<string>;
}> {
  const byItunesId = new Map<string, string>();
  const bySpotifyId = new Map<string, string>();
  const byIsrc = new Map<string, string>();
  const byNormKey = new Map<string, string>();
  const byPrimaryKey = new Map<string, string>();
  const needsItunesFill = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("songs")
      .select(
        "id, title, artist, spotify_track_id, spotify_isrc, itunes_track_id, itunes_preview_url",
      )
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.itunes_track_id) byItunesId.set(String(r.itunes_track_id), r.id);
      if (r.spotify_track_id) bySpotifyId.set(r.spotify_track_id, r.id);
      if (r.spotify_isrc) byIsrc.set(r.spotify_isrc, r.id);
      if (!r.itunes_preview_url) needsItunesFill.add(r.id);
      const title = normalizeTitle(r.title);
      const k = normalizeArtistName(r.artist ?? "") + "|" + title;
      if (!byNormKey.has(k)) byNormKey.set(k, r.id);
      const pk =
        normalizeArtistName(primaryArtistName(r.artist ?? "")) + "|" + title;
      if (!byPrimaryKey.has(pk)) byPrimaryKey.set(pk, r.id);
    }
    if (data.length < PAGE) break;
  }
  return {
    byItunesId,
    bySpotifyId,
    byIsrc,
    byNormKey,
    byPrimaryKey,
    needsItunesFill,
  };
}

/** artists に該当が無ければ最低限の行を作って artist_id を返す。 */
async function ensureArtistId(
  supabase: ReturnType<typeof createAdminClient>,
  artistName: string,
  artistByNorm: Map<string, string>,
): Promise<string | null> {
  const aKey = normalizeArtistName(artistName);
  const existing = artistByNorm.get(aKey);
  if (existing) return existing;
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
  artistByNorm.set(aKey, data.id);
  return data.id;
}

/**
 * songs に該当が無い Spotify track を新規 INSERT し、song_id を返す。
 * artists が存在しなければ最低限の行を作って link する。
 */
async function insertSongFromSpotify(
  supabase: ReturnType<typeof createAdminClient>,
  track: SpotifyTrack,
  artistByNorm: Map<string, string>,
  itunes: ItunesTrack | null,
): Promise<string | null> {
  const title = track.name;
  const artistName = track.artists[0]?.name ?? "";

  const artistId = await ensureArtistId(supabase, artistName, artistByNorm);
  if (!artistId) return null;

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
    spotify_explicit: track.explicit,
    spotify_isrc: track.external_ids?.isrc ?? null,
    source_urls: [`https://open.spotify.com/track/${track.id}`],
  };
  // iTunes 側が解決できていれば、試聴音源を最初から埋めておく。
  // (これが無いと backfill:itunes-previews が拾うまでデッキで無音になる)
  if (itunes) {
    songRow.itunes_track_id = itunes.trackId;
    songRow.itunes_preview_url = itunes.previewUrl ?? null;
    songRow.itunes_preview_checked_at = new Date().toISOString();
    if (itunes.trackViewUrl) {
      songRow.source_urls = [
        ...(songRow.source_urls as string[]),
        itunes.trackViewUrl,
      ];
    }
  }
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

/**
 * Spotify で解決できなかったチャート曲を iTunes の情報だけで INSERT する。
 * spotify_track_id は付かないが、以前はここで取りこぼして順位ごと欠落して
 * いたので、チャートの完全性を優先する。Spotify ID は後日 match:dam が拾う。
 */
async function insertSongFromItunes(
  supabase: ReturnType<typeof createAdminClient>,
  itunes: ItunesTrack,
  artistByNorm: Map<string, string>,
): Promise<string | null> {
  const artistName = itunes.artistName ?? "";
  const artistId = await ensureArtistId(supabase, artistName, artistByNorm);
  if (!artistId) return null;

  const artworkSmall = itunes.artworkUrl100 ?? null;
  const releaseYear = itunes.releaseDate
    ? parseInt(itunes.releaseDate.slice(0, 4), 10)
    : null;

  const songRow: SongInsert = {
    title: itunes.trackName,
    artist: artistName,
    artist_id: artistId,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    image_url_small: artworkSmall,
    image_url_medium: artworkSmall ? resizeArtwork(artworkSmall, 600) : null,
    image_url_large: artworkSmall ? resizeArtwork(artworkSmall, 1200) : null,
    duration_ms: itunes.trackTimeMillis ?? null,
    itunes_track_id: itunes.trackId,
    itunes_preview_url: itunes.previewUrl ?? null,
    itunes_preview_checked_at: new Date().toISOString(),
    source_urls: itunes.trackViewUrl ? [itunes.trackViewUrl] : [],
  };
  const { data, error } = await supabase
    .from("songs")
    .insert(songRow)
    .select("id")
    .single();
  if (error) {
    console.warn(
      `  [WARN-INSERT-SONG-IT] ${artistName} | ${itunes.trackName}: ${error.message}`,
    );
    return null;
  }
  return data.id;
}

/** 既存曲に iTunes 由来のプレビュー情報が欠けていれば埋める (上書きはしない)。 */
async function fillItunesPreview(
  supabase: ReturnType<typeof createAdminClient>,
  songId: string,
  itunes: ItunesTrack,
): Promise<boolean> {
  const updates: SongUpdate = {
    itunes_track_id: itunes.trackId,
    itunes_preview_checked_at: new Date().toISOString(),
  };
  if (itunes.previewUrl) updates.itunes_preview_url = itunes.previewUrl;
  const { error } = await supabase
    .from("songs")
    .update(updates)
    .eq("id", songId);
  if (error) {
    console.warn(`  [WARN-FILL-IT] ${songId}: ${error.message}`);
    return false;
  }
  return Boolean(itunes.previewUrl);
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

  // Spotify token は「iTunes でも既存曲に結び付かなかった曲」が出た時にだけ
  // 必要なので遅延取得する。多くの週は 1 度も呼ばれずに終わる。
  let spotifyToken: string | null = null;
  let spotifyUnavailable = false;
  const ensureSpotifyToken = async (): Promise<string | null> => {
    if (spotifyUnavailable) return null;
    if (spotifyToken) return spotifyToken;
    try {
      spotifyToken = await getSpotifyToken();
      return spotifyToken;
    } catch (e) {
      spotifyUnavailable = true;
      console.warn(`[spotify] token 取得失敗: ${(e as Error).message}`);
      console.warn("[spotify] 以降は iTunes の情報だけで取り込む");
      return null;
    }
  };

  // --- 1. Apple Top 100 ----------------------------------------------------
  const appleItems = await fetchAppleTop100();
  console.log(`apple top100: fetched ${appleItems.length}`);

  if (appleItems.length === 0) {
    console.error("Apple RSS 取得失敗。終了。");
    process.exit(1);
  }

  // --- 2. RSS の id (= iTunes trackId) を一括解決 --------------------------
  const itunesById = await fetchItunesLookup(appleItems.map((a) => a.entry.id));
  console.log(
    `itunes lookup: ${itunesById.size}/${appleItems.length} resolved`,
  );

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

  let spotifySearches = 0;
  let previewsFilled = 0;

  for (const { rank, entry } of appleItems) {
    const it = itunesById.get(entry.id) ?? null;

    // 既存マッチ: itunes_track_id の完全一致 → 正規化 title+artist
    // (RSS 表記と iTunes 正規表記の両方で引く)
    const normKey =
      normalizeArtistName(entry.artistName) + "|" + normalizeTitle(entry.name);
    const primaryKey =
      normalizeArtistName(primaryArtistName(entry.artistName)) +
      "|" +
      normalizeTitle(entry.name);
    let songId =
      songIdx.byItunesId.get(entry.id) ?? songIdx.byNormKey.get(normKey);
    if (!songId && it) {
      const itKey =
        normalizeArtistName(it.artistName) + "|" + normalizeTitle(it.trackName);
      songId = songIdx.byNormKey.get(itKey);
    }
    if (!songId) {
      // 共演者を並べた表記 ("A, B & C") は主アーティストだけで引き直す。
      // これを飛ばすと既存曲と別行で重複 INSERT してしまう。
      songId = songIdx.byPrimaryKey.get(primaryKey);
      if (!songId && it) {
        songId = songIdx.byPrimaryKey.get(
          normalizeArtistName(primaryArtistName(it.artistName)) +
            "|" +
            normalizeTitle(it.trackName),
        );
      }
    }

    if (!songId) {
      // DB 未収録。Spotify で解決できれば spotify_track_id 付きで INSERT し、
      // 駄目でも iTunes の情報だけで INSERT してチャートからは落とさない。
      const token = await ensureSpotifyToken();
      let candidates: SpotifyTrack[] = [];
      if (token) {
        try {
          candidates = await searchSpotify(token, entry.name, entry.artistName);
          spotifySearches++;
          await sleep(INTERVAL_MS);
        } catch (e) {
          if (e instanceof QuotaExceededError) {
            console.warn(
              `  [QUOTA] spotify search 打ち切り rank=${rank} (以降は iTunes のみ)`,
            );
            spotifyUnavailable = true;
          } else {
            console.warn(
              `  [WARN-SEARCH] apple rank=${rank}: ${(e as Error).message}`,
            );
          }
        }
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
              it,
            );
            if (newId) {
              songId = newId;
              songIdx.bySpotifyId.set(tr.id, newId);
              if (tr.external_ids?.isrc)
                songIdx.byIsrc.set(tr.external_ids.isrc, newId);
              songIdx.byNormKey.set(normKey, newId);
              songIdx.byPrimaryKey.set(primaryKey, newId);
              if (it) songIdx.byItunesId.set(entry.id, newId);
            }
          }
        }
      } else if (it) {
        if (dryRun) {
          console.log(
            `  [DRY-NEW-IT] rank=${rank} ${it.artistName} | ${it.trackName}`,
          );
        } else {
          const newId = await insertSongFromItunes(supabase, it, artistByNorm);
          if (newId) {
            songId = newId;
            songIdx.byItunesId.set(entry.id, newId);
            songIdx.byNormKey.set(normKey, newId);
            songIdx.byPrimaryKey.set(primaryKey, newId);
          }
        }
      } else {
        console.log(
          `  [NOMATCH-AP] rank=${rank} ${entry.artistName} | ${entry.name}`,
        );
      }
    } else if (it && songIdx.needsItunesFill.has(songId) && !dryRun) {
      // 既存曲だがプレビュー未取得。チャート解決のついでに埋めておく
      // (backfill:itunes-previews の順番待ちを飛ばせる)。
      if (await fillItunesPreview(supabase, songId, it)) previewsFilled++;
      songIdx.needsItunesFill.delete(songId);
      songIdx.byItunesId.set(entry.id, songId);
    }

    if (songId) {
      // 同じ曲が複数バージョンでチャートインすることがある
      // (例: "Yes! 東京" が rank 9 と rank 100 の 2 バージョン)。
      // 後勝ちにすると下位の順位で上書きされてしまうので上位を採る。
      const bucket = ensureBucket(songId);
      bucket.sources.apple = Math.min(bucket.sources.apple ?? rank, rank);
    }
  }

  console.log(
    `resolved buckets: ${buckets.size} (spotify search: ${spotifySearches} calls, itunes preview filled: ${previewsFilled})`,
  );

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

  // 検索タブは weekly_rankings ではなく browse_snapshots を読むため、
  // ここで再計算しないとカルーセルが前週のまま残る。夜間ルーチン経由なら
  // Step 4 でも走るが、このスクリプト単体で叩かれる場合に取りこぼすので
  // 更新元と同じトランザクション境界で呼んでおく。
  const { error: snapErr } = await supabase.rpc("refresh_browse_snapshot");
  if (snapErr) {
    console.error(`refresh_browse_snapshot failed: ${snapErr.message}`);
    process.exit(1);
  }
  console.log("browse snapshot refreshed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

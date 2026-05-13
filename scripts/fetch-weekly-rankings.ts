/**
 * 週次ランキング取得・集計スクリプト。
 *
 * ソース:
 *   - Spotify "Top 50 - Japan" (editorial playlist)
 *   - Apple Music Top 100 JP (Marketing Tools RSS, 無認証)
 *
 * 処理フロー:
 *   1. 両ソースから tracks 配列を取得
 *   2. Spotify トラックは spotify_track_id / ISRC で songs テーブルにマッチ
 *   3. Apple Music トラックは Spotify search で Spotify ID を解決し同じく match
 *   4. DB に無い曲は新規 INSERT (画像・メタフル付与)
 *   5. ソース横断スコア (正規化 Borda) を合算
 *   6. weekly_rankings に upsert (week_start = 今週月曜 UTC)
 *
 * 注意:
 *   - Spotify editorial playlist は 2024 後半〜新規 app で 404 になる例あり。
 *     失敗時は警告のみ出して Apple ソースのみで処理継続。
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
const SPOTIFY_PLAYLIST_URL = "https://api.spotify.com/v1/playlists";

// Spotify "Top 50 - Japan" editorial playlist (Daily Charts)
// 別の playlist を使いたい場合は SPOTIFY_TOP50_JP_PLAYLIST_ID で上書き可能
const DEFAULT_SPOTIFY_TOP50_JP = "37i9dQZEVXbKXQ4mDTEBXq";

// Apple Music の Marketing Tools RSS (JP 国コード)。サインインや API key 不要。
// 100 件取得 = .../most-played/100/songs.json
const APPLE_TOP100_JP_RSS =
  "https://rss.applemarketingtools.com/api/v2/jp/music/most-played/100/songs.json";

// YouTube Data API v3 の videos?chart=mostPopular に videoCategoryId=10 (音楽)
// + regionCode=JP を組み合わせて「日本の音楽カテゴリでトレンド中の動画」を取る。
// YouTube Music Charts の CSV は login 必須なのでこちらを代替として採用。
const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos";
const YOUTUBE_TOP_LIMIT = 50;

const INTERVAL_MS = 1500;
const MAX_RETRY_AFTER_SEC = 120;
const MIN_TITLE_SIM = 0.8;
const MIN_TITLE_SIM_YT = 0.5; // YouTube タイトルはノイズが多いので閾値を緩める
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

interface PlaylistTrackItem {
  track: SpotifyTrack | null;
}
interface PlaylistResponse {
  items: PlaylistTrackItem[];
  next: string | null;
}

/** Spotify Top 50 Japan のトラックを順位付きで返す。失敗時は空配列。 */
async function fetchSpotifyTop50(
  token: string,
  playlistId: string,
): Promise<Array<{ rank: number; track: SpotifyTrack }>> {
  const url = new URL(`${SPOTIFY_PLAYLIST_URL}/${playlistId}/tracks`);
  url.searchParams.set("market", "JP");
  url.searchParams.set(
    "fields",
    "items(track(id,name,artists(name),album(name,release_date,images),duration_ms,preview_url,explicit,external_ids)),next",
  );
  url.searchParams.set("limit", "50");
  const res = await spotifyGet(token, url);
  if (!res.ok) {
    console.warn(
      `[spotify] playlist ${playlistId} fetch failed: ${res.status}. ` +
        `Editorial playlist の取得が新規 app で制限されている可能性あり。`,
    );
    return [];
  }
  const json = (await res.json()) as PlaylistResponse;
  const out: Array<{ rank: number; track: SpotifyTrack }> = [];
  let rank = 1;
  for (const item of json.items) {
    if (!item.track || !item.track.id) continue;
    out.push({ rank, track: item.track });
    rank++;
  }
  return out;
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
  minTitleSim: number = MIN_TITLE_SIM,
): { track: SpotifyTrack; titleSim: number; artistSim: number } | null {
  let best:
    | { track: SpotifyTrack; titleSim: number; artistSim: number }
    | null = null;
  for (const t of candidates) {
    const ts = similarity(wantedTitle, t.name, normalizeTitle);
    if (ts < minTitleSim) continue;
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

// --- YouTube Music (代替: Data API mostPopular Music category) -------------

interface YouTubeVideo {
  id: string;
  snippet: {
    title: string;
    channelTitle: string;
  };
}

/**
 * YouTube タイトルから (title, artist) を推定する。
 *
 * 方針:
 *   - artist は **常に channelTitle を採用**。YouTube は誰がアップしたかが
 *     構造化情報として取れるので、本文を解釈するより信頼度が高い。
 *   - title は以下の順序で抽出:
 *       1. 「」『』 内（J-POP MV で曲名がここに入る慣習が定着）
 *       2. channelTitle を本文から削除した後の "X - Y" / "X / Y" → 短い側
 *       3. 上記が無ければ全体（注釈/ノイズだけ剥がして渡す）
 *   - 末尾の Official MV / Performance Video / Dance Practice 等の語句、
 *     " / ChannelName" 形式の suffix は剥がす。
 *
 * 完璧な抽出は無理。Spotify search のあいまい一致 + 低い title 類似度閾値
 * (YouTube 経路は MIN_TITLE_SIM_YT を別途使う) で吸収する想定。
 */
function parseYouTubeTitle(
  rawTitle: string,
  channelTitle: string,
): { title: string; artist: string } {
  let s = rawTitle;

  // 末尾の " / X" suffix (channel 名を二重に書く慣習) を剥がす
  s = s.replace(/\s*[\/／]\s*[^\/／]{1,40}$/u, "").trim();

  // channelTitle そのものが title に紛れている場合は除去
  if (channelTitle && channelTitle.length >= 2) {
    s = s.split(channelTitle).join(" ").replace(/\s{2,}/g, " ").trim();
  }

  // 括弧内の注釈系を除去 (MV / Official / Live / Performance 系)
  s = s.replace(
    /[(（\[【][^)）\]】]*(MV|Music Video|Official|Audio|Lyric|Live|Performance|Dance Practice|Visualizer|TAKE|ver\.?|version)[^)）\]】]*[)）\]】]/gi,
    "",
  );

  // 単独で出てくるノイズ語を除去
  s = s
    .replace(
      /\b(?:Official\s+)?(?:Music\s+)?(?:Video|MV|Audio|Lyric\s+Video|Visualizer|Performance\s+Video|Dance\s+Practice(?:\s+Movie)?)\b/gi,
      "",
    )
    .replace(/[\s]{2,}/g, " ")
    .trim();

  // 「」『』 抽出: 内容を曲名とする
  const bracket = s.match(/[「『](.+?)[」』]/);
  if (bracket) {
    return { title: bracket[1].trim(), artist: channelTitle };
  }

  // "X - Y" / "X / Y": どちらが曲名か分からないので短い方を曲名にする
  // (アーティスト名は long、曲名は short の傾向が J-POP MV では強い)
  const sep = s.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (sep) {
    const left = sep[1].trim();
    const right = sep[2].trim();
    const title = left.length < right.length ? left : right;
    return { title, artist: channelTitle };
  }

  return { title: s || rawTitle, artist: channelTitle };
}

async function fetchYouTubeTop50(): Promise<
  Array<{ rank: number; title: string; artist: string; videoId: string }>
> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn("[youtube] YOUTUBE_API_KEY 未設定。スキップ");
    return [];
  }
  const url = new URL(YOUTUBE_API_URL);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", "JP");
  url.searchParams.set("videoCategoryId", "10"); // Music
  url.searchParams.set("maxResults", String(YOUTUBE_TOP_LIMIT));
  url.searchParams.set("key", apiKey);
  const res = await fetch(url.toString());
  if (!res.ok) {
    console.warn(
      `[youtube] mostPopular fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
    return [];
  }
  const json = (await res.json()) as { items?: YouTubeVideo[] };
  const items = json.items ?? [];
  return items.map((v, i) => {
    const { title, artist } = parseYouTubeTitle(
      v.snippet.title,
      v.snippet.channelTitle,
    );
    return { rank: i + 1, title, artist, videoId: v.id };
  });
}

// --- 集計 & DB upsert ------------------------------------------------------

/**
 * 1 曲がランキング上に占める情報。song_id が決まったら sources にスコアを足していく。
 */
interface RankedSongBucket {
  songId: string;
  // ソース別の順位。null なら未登場。
  sources: { spotify?: number; apple?: number; youtube?: number };
}

/**
 * 正規化 Borda スコア:
 *   spotify (50件) → (51 - rank) / 50
 *   apple   (100件) → (101 - rank) / 100
 *   youtube (50件) → (51 - rank) / 50
 *   各ソースの最大寄与は 1.0。3 ソース全 1 位なら 3.0 が上限。
 */
function computeScore(sources: RankedSongBucket["sources"]): number {
  let s = 0;
  if (sources.spotify) s += (51 - sources.spotify) / 50;
  if (sources.apple) s += (101 - sources.apple) / 100;
  if (sources.youtube) s += (51 - sources.youtube) / 50;
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
  const playlistId =
    process.env.SPOTIFY_TOP50_JP_PLAYLIST_ID ?? DEFAULT_SPOTIFY_TOP50_JP;
  console.log(`week_start=${weekStart}, dryRun=${dryRun}`);
  console.log(`spotify playlist=${playlistId}`);

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

  // --- 1. Spotify Top 50 ---------------------------------------------------
  const spotifyItems = await fetchSpotifyTop50(token, playlistId);
  console.log(`spotify top50: fetched ${spotifyItems.length}`);

  // --- 2. Apple Top 100 ----------------------------------------------------
  const appleItems = await fetchAppleTop100();
  console.log(`apple top100: fetched ${appleItems.length}`);

  // --- 3. YouTube Top 50 (Music カテゴリ) ---------------------------------
  const youtubeItems = await fetchYouTubeTop50();
  console.log(`youtube top50: fetched ${youtubeItems.length}`);

  if (
    spotifyItems.length === 0 &&
    appleItems.length === 0 &&
    youtubeItems.length === 0
  ) {
    console.error("全ソース取得失敗。終了。");
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

  for (const { rank, track } of spotifyItems) {
    let songId =
      songIdx.bySpotifyId.get(track.id) ??
      (track.external_ids?.isrc
        ? songIdx.byIsrc.get(track.external_ids.isrc)
        : undefined) ??
      songIdx.byNormKey.get(
        normalizeArtistName(track.artists[0]?.name ?? "") +
          "|" +
          normalizeTitle(track.name),
      );
    if (!songId) {
      if (dryRun) {
        console.log(
          `  [DRY-NEW-SP] rank=${rank} ${track.artists[0]?.name} | ${track.name}`,
        );
      } else {
        const newId = await insertSongFromSpotify(
          supabase,
          track,
          artistByNorm,
        );
        if (newId) {
          songId = newId;
          songIdx.bySpotifyId.set(track.id, newId);
          if (track.external_ids?.isrc)
            songIdx.byIsrc.set(track.external_ids.isrc, newId);
        }
      }
    }
    if (songId) {
      ensureBucket(songId).sources.spotify = rank;
    }
  }

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

  // YouTube: スコアエンハンスメント専用 (新規 songs INSERT はしない)。
  // 理由: YT タイトル抽出が不安定で誤挿入リスクが高いため、既存 songs と
  // マッチした場合のみ youtube_rank を加算する。新規曲の取り込みは Apple
  // 経路 (構造化された RSS) に任せる。
  for (const item of youtubeItems) {
    const { rank, title, artist } = item;
    const titleNorm = normalizeTitle(title);
    const artistNorm = normalizeArtistName(artist);
    const normKey = artistNorm + "|" + titleNorm;

    // 1. ノルム key で既存曲にヒットすれば即採用 (Spotify call 不要)
    let songId = songIdx.byNormKey.get(normKey);

    // 2. それでも見つからなければ Spotify search で track ID を解決し、
    //    既存 songs (bySpotifyId / byIsrc) と突き合わせる
    if (!songId) {
      let candidates: SpotifyTrack[] = [];
      try {
        candidates = await searchSpotify(token, title, artist);
        await sleep(INTERVAL_MS);
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          console.warn(`  [QUOTA] youtube search 中止 rank=${rank}`);
          break;
        }
        console.warn(
          `  [WARN-SEARCH] youtube rank=${rank}: ${(e as Error).message}`,
        );
      }
      const match = pickBestMatch(title, artist, candidates, MIN_TITLE_SIM_YT);
      if (match) {
        const tr = match.track;
        songId =
          songIdx.bySpotifyId.get(tr.id) ??
          (tr.external_ids?.isrc
            ? songIdx.byIsrc.get(tr.external_ids.isrc)
            : undefined);
        if (!songId) {
          // Spotify では見つかったが songs テーブルに無い曲。YouTube
          // 経路では新規 INSERT しない (ノイズ防止)。
          console.log(
            `  [SKIP-NEW-YT] rank=${rank} ${artist} | ${title} (songs に無いので enhancement のみ skip)`,
          );
        }
      } else {
        console.log(`  [NOMATCH-YT] rank=${rank} ${artist} | ${title}`);
      }
    }
    if (songId) {
      ensureBucket(songId).sources.youtube = rank;
    }
  }

  console.log(`resolved buckets: ${buckets.size}`);

  // --- 4. スコア合算 + final_rank 採番 -----------------------------------
  const ranked = Array.from(buckets.values())
    .map((b) => ({ ...b, score: computeScore(b.sources) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // tie-breaker: Spotify → Apple → YouTube の順で上位 rank を優先
      const aRank =
        a.sources.spotify ?? a.sources.apple ?? a.sources.youtube ?? 9999;
      const bRank =
        b.sources.spotify ?? b.sources.apple ?? b.sources.youtube ?? 9999;
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

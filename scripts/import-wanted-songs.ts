/**
 * scripts/wanted-songs.json に列挙した (title, artist) を Spotify Search で
 * 個別取得し、DB に INSERT する (画像 / Spotify ID / 各種メタ全付き)。
 *
 * 用途:
 *   DAM/JOYSOUND ランキングの TOP 100 圏外でユーザーが特定したい曲を
 *   ピンポイントで取り込むため。
 *
 * 仕様:
 *  - Spotify Search で `track:"TITLE" artist:"ARTIST"` クエリ (market=JP)
 *  - 上位 5 件から (title 類似度, artist 類似度) で最良を選定
 *  - 既存 (artist_id, normalized title) と衝突するならスキップ
 *  - artist が DB に居なければ新規作成 (genres は空)
 *  - song を INSERT。Spotify ID, image, duration, popularity, preview, ISRC,
 *    explicit, release_year を全部埋める
 *  - 1 件ごとに Spotify call 1 回 (Search) + 場合によって Artist Top で確証
 *  - 1.5s 間隔で polite に
 *
 * 使い方:
 *   pnpm import:wanted-songs                       # wanted-songs.json を読む
 *   pnpm import:wanted-songs -- --file path.json   # 別ファイル指定可
 *   pnpm import:wanted-songs -- --dry-run
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type ArtistInsert = Database["public"]["Tables"]["artists"]["Insert"];

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_SEARCH_URL = "https://api.spotify.com/v1/search";
const INTERVAL_MS = 1500;
// 短いタイトル (3-4 chars) で 0.6 だと "化け物" vs "化け猫" のような別曲を
// 誤マッチしてしまう。0.85 にして同表記揺れ程度のみ許容。
const MIN_TITLE_SIM = 0.85;
const MIN_ARTIST_SIM = 0.4;
const MAX_RETRY_AFTER_SEC = 120;

interface WantedRow {
  title: string;
  artist: string;
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
  popularity: number;
  preview_url: string | null;
  explicit: boolean;
  external_ids?: { isrc?: string };
}

interface SearchResponse {
  tracks?: { items: SpotifyTrack[] };
}

class QuotaExceededError extends Error {
  constructor(public retryAfter: number) {
    super(`spotify quota (Retry-After=${retryAfter}s)`);
  }
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let file: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--file") file = args[i + 1] ?? null;
    else if (args[i] === "--dry-run") dryRun = true;
  }
  return { file, dryRun };
}

// --- text utilities ---------------------------------------------------------

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

// --- Spotify ---------------------------------------------------------------

async function getSpotifyToken(): Promise<string> {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("missing SPOTIFY_CLIENT_ID/SECRET");
  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
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

/** アーティスト名を Spotify の canonical name に解決する。
 *  例: "クリープハイプ" → "Creep Hyp" / "キタニタツヤ" → "Tatsuya Kitani" */
async function resolveArtistCanonical(
  token: string,
  artist: string,
): Promise<string[]> {
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set("q", artist);
  url.searchParams.set("type", "artist");
  url.searchParams.set("market", "JP");
  url.searchParams.set("limit", "3");
  const res = await spotifyGet(token, url);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    artists?: { items: Array<{ name: string }> };
  };
  return (json.artists?.items ?? []).map((a) => a.name);
}

async function searchSpotify(
  token: string,
  title: string,
  artist: string,
): Promise<SpotifyTrack[]> {
  // 厳密構文 (track:"X" artist:"Y") は日本語アーティストの場合 Spotify が
  // 英訳名で登録しているケースで 0 件になりやすい。プレーンクエリを使う。
  const url = new URL(SPOTIFY_SEARCH_URL);
  url.searchParams.set("q", `${title} ${artist}`);
  url.searchParams.set("type", "track");
  url.searchParams.set("market", "JP");
  url.searchParams.set("limit", "10");
  const res = await spotifyGet(token, url);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const json = (await res.json()) as SearchResponse;
  return json.tracks?.items ?? [];
}

function pickBestMatch(
  wantedTitle: string,
  wantedArtist: string,
  artistAliases: string[], // 元の名前 + Spotify 解決後の canonical name
  candidates: SpotifyTrack[],
): { track: SpotifyTrack; titleSim: number; artistSim: number } | null {
  let best: { track: SpotifyTrack; titleSim: number; artistSim: number } | null =
    null;
  for (const t of candidates) {
    const ts = similarity(wantedTitle, t.name, normalizeTitle);
    if (ts < MIN_TITLE_SIM) continue;
    // 結果の各 artist と元の wanted name + 解決された canonical name 全てを
    // 比較し、最も高い類似度を採用 (日本語/英語跨ぎを救済)。
    let aMaxSim = 0;
    for (const candArtist of t.artists) {
      for (const wantedName of artistAliases) {
        const s = similarity(wantedName, candArtist.name, normalizeArtistName);
        if (s > aMaxSim) aMaxSim = s;
      }
    }
    if (aMaxSim < MIN_ARTIST_SIM) continue;
    const score = ts * 0.6 + aMaxSim * 0.4;
    const bestScore = best ? best.titleSim * 0.6 + best.artistSim * 0.4 : -1;
    if (score > bestScore) best = { track: t, titleSim: ts, artistSim: aMaxSim };
  }
  return best;
}

// --- main ------------------------------------------------------------------

async function main() {
  const { file, dryRun } = parseArgs();
  const path = resolve(
    process.cwd(),
    file ?? "scripts/wanted-songs.json",
  );
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const wanted = JSON.parse(readFileSync(path, "utf-8")) as WantedRow[];
  console.log(`wanted: ${wanted.length} songs, dryRun=${dryRun}`);

  const supabase = createAdminClient();

  // 既存 artists / songs index を作る
  const dbArtists: Array<{ id: string; name: string; name_norm: string | null }> =
    [];
  {
    let offset = 0;
    for (;;) {
      const { data } = await supabase
        .from("artists")
        .select("id, name, name_norm")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      dbArtists.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
  }
  const artistByNorm = new Map<string, { id: string; name: string }>();
  for (const a of dbArtists) {
    const k = normalizeArtistName(a.name);
    if (!artistByNorm.has(k)) artistByNorm.set(k, { id: a.id, name: a.name });
    if (a.name_norm) {
      const k2 = a.name_norm.toLowerCase().normalize("NFKC").replace(/\s+/g, "");
      if (!artistByNorm.has(k2))
        artistByNorm.set(k2, { id: a.id, name: a.name });
    }
  }

  const existingSongKeys = new Set<string>();
  {
    let offset = 0;
    for (;;) {
      const { data } = await supabase
        .from("songs")
        .select("title, artist")
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        existingSongKeys.add(
          normalizeArtistName(r.artist || "") + "|" + normalizeTitle(r.title),
        );
      }
      if (data.length < 1000) break;
      offset += 1000;
    }
  }

  const token = await getSpotifyToken();

  // wanted で出てくる各 artist を canonical 名に解決 (1 回キャッシュ)
  const artistAliasCache = new Map<string, string[]>();

  let inserted = 0;
  let skippedDup = 0;
  let unmatched = 0;
  const failures: WantedRow[] = [];

  for (let i = 0; i < wanted.length; i++) {
    const w = wanted[i];
    const dupKey = normalizeArtistName(w.artist) + "|" + normalizeTitle(w.title);
    if (existingSongKeys.has(dupKey)) {
      console.log(`  [SKIP-DUP] ${w.artist} | ${w.title}`);
      skippedDup++;
      continue;
    }

    // artist aliases (元 + canonical) を取得
    let aliases = artistAliasCache.get(w.artist);
    if (!aliases) {
      try {
        const canonicals = await resolveArtistCanonical(token, w.artist);
        aliases = [w.artist, ...canonicals];
        artistAliasCache.set(w.artist, aliases);
        await sleep(INTERVAL_MS);
        if (canonicals.length > 0)
          console.log(`    resolved "${w.artist}" → ${JSON.stringify(canonicals)}`);
      } catch (e) {
        if (e instanceof QuotaExceededError) {
          console.error(`  [QUOTA] aborting at artist resolve. Retry-After=${e.retryAfter}s`);
          break;
        }
        aliases = [w.artist];
      }
    }

    let candidates: SpotifyTrack[] = [];
    try {
      candidates = await searchSpotify(token, w.title, w.artist);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.error(`  [QUOTA] aborting. Retry-After=${e.retryAfter}s`);
        break;
      }
      console.error(`  [ERR] ${w.artist} | ${w.title}: ${(e as Error).message}`);
      failures.push(w);
      continue;
    }
    await sleep(INTERVAL_MS);

    const match = pickBestMatch(w.title, w.artist, aliases, candidates);
    if (!match) {
      console.log(`  [NOMATCH] ${w.artist} | ${w.title}`);
      unmatched++;
      failures.push(w);
      continue;
    }

    const t = match.track;
    const album = t.album;
    const artworkLarge = album.images?.[0]?.url ?? null;
    const artworkMedium = album.images?.[1]?.url ?? artworkLarge;
    const artworkSmall = album.images?.[2]?.url ?? artworkMedium;
    const releaseYear = album.release_date
      ? parseInt(album.release_date.slice(0, 4), 10)
      : null;
    const spotifyArtistName = t.artists[0]?.name ?? w.artist;

    // artist resolution: 既存と一致するなら link、しないなら create
    const aKeys = [
      normalizeArtistName(w.artist),
      normalizeArtistName(spotifyArtistName),
    ];
    let artistId: string | null = null;
    for (const k of aKeys) {
      const found = artistByNorm.get(k);
      if (found) {
        artistId = found.id;
        break;
      }
    }
    if (!artistId) {
      // 新規作成
      if (!dryRun) {
        const ins: ArtistInsert = {
          name: w.artist,
          name_norm: normalizeArtistName(w.artist),
          genres: [],
        };
        const { data, error } = await supabase
          .from("artists")
          .insert(ins)
          .select("id, name")
          .single();
        if (error) {
          console.error(`  [ERR-ARTIST] ${w.artist}: ${error.message}`);
          failures.push(w);
          continue;
        }
        artistId = data.id;
        artistByNorm.set(normalizeArtistName(data.name), { id: data.id, name: data.name });
      } else {
        artistId = "<dry-run-new-artist>";
      }
    }

    const songRow: SongInsert = {
      title: w.title,
      artist: w.artist,
      artist_id: artistId,
      release_year: releaseYear,
      image_url_large: artworkLarge,
      image_url_medium: artworkMedium,
      image_url_small: artworkSmall,
      duration_ms: t.duration_ms,
      spotify_track_id: t.id,
      spotify_popularity: t.popularity,
      spotify_preview_url: t.preview_url,
      spotify_explicit: t.explicit,
      spotify_isrc: t.external_ids?.isrc ?? null,
      is_popular: true,
      source_urls: [`https://open.spotify.com/track/${t.id}`],
    };

    if (dryRun) {
      console.log(
        `  [DRY-INS] ${w.artist} | ${w.title} → "${t.name}" by "${t.artists[0]?.name}" (${t.id})`,
      );
      inserted++;
    } else {
      const { error } = await supabase.from("songs").insert(songRow);
      if (error) {
        console.error(`  [ERR-INS] ${w.artist} | ${w.title}: ${error.message}`);
        failures.push(w);
        continue;
      }
      console.log(
        `  [INS] ${w.artist} | ${w.title} → "${t.name}" by "${t.artists[0]?.name}" sim=${match.titleSim.toFixed(2)}/${match.artistSim.toFixed(2)}`,
      );
      inserted++;
      existingSongKeys.add(dupKey);
    }
  }

  console.log(`\n=== summary ===`);
  console.log(
    JSON.stringify({ inserted, skippedDup, unmatched, total: wanted.length }, null, 2),
  );
  if (failures.length > 0) {
    console.log("\nfailures:");
    for (const f of failures) console.log(`  ${f.artist} | ${f.title}`);
  }
  console.log(`done (${dryRun ? "DRY-RUN" : "applied"}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * scripts/wanted-artists.json に列挙したアーティストの曲を Spotify Search で
 * 一括取得し、DB に INSERT する。
 *
 * 用途:
 *   特定アーティスト (vocaloid producer / アイドルグループ等) のレパートリー
 *   全般を一気に取り込む。`/v1/artists/{id}/top-tracks` は新規アプリ向けに
 *   廃止 (403) されているため、`/v1/search?type=track&q=<artist>` で代替する。
 *
 * 仕様:
 *  - artist 名で track 検索 (limit=50, market=JP)
 *  - 結果のうち artists にその名前を含むトラックのみ採用
 *  - 既存 (artist_id, normalize(title)) 衝突するならスキップ
 *  - artist が DB に居なければ新規作成
 *  - 1.5s 間隔
 *
 * 使い方:
 *   pnpm import:artist-songs                       # wanted-artists.json
 *   pnpm import:artist-songs -- --file path.json
 *   pnpm import:artist-songs -- --dry-run
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
// Spotify search の limit は新規アプリでは 10 が上限 (2024-2025 の制限変更)。
const PAGE_LIMIT = 10;
const PAGES_PER_ARTIST = 3; // = up to 30 candidates per artist
const MAX_PER_ARTIST = 5; // 1 アーティストあたり最大投入数 (代表曲のみ)
const MAX_RETRY_AFTER_SEC = 120;

interface SpotifyTrack {
  id: string;
  name: string;
  artists: Array<{ name: string; id: string }>;
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
  tracks?: { items: SpotifyTrack[]; total: number; next?: string | null };
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

async function searchTracksByArtist(
  token: string,
  artist: string,
): Promise<SpotifyTrack[]> {
  const all: SpotifyTrack[] = [];
  for (let page = 0; page < PAGES_PER_ARTIST; page++) {
    const url = new URL(SPOTIFY_SEARCH_URL);
    url.searchParams.set("q", artist);
    url.searchParams.set("type", "track");
    url.searchParams.set("market", "JP");
    url.searchParams.set("limit", String(PAGE_LIMIT));
    url.searchParams.set("offset", String(page * PAGE_LIMIT));
    const res = await spotifyGet(token, url);
    if (!res.ok) {
      console.error(`  search "${artist}" page ${page}: ${res.status}`);
      break;
    }
    const json = (await res.json()) as SearchResponse;
    const items = json.tracks?.items ?? [];
    all.push(...items);
    await sleep(INTERVAL_MS);
    if (items.length < PAGE_LIMIT) break; // no more
  }
  return all;
}

async function main() {
  const { file, dryRun } = parseArgs();
  const path = resolve(process.cwd(), file ?? "scripts/wanted-artists.json");
  if (!existsSync(path)) throw new Error(`file not found: ${path}`);
  const wantedArtists = JSON.parse(readFileSync(path, "utf-8")) as string[];
  console.log(`wanted artists: ${wantedArtists.length}, dryRun=${dryRun}`);

  const supabase = createAdminClient();

  // 既存 artists / songs index
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

  let inserted = 0;
  let skippedDup = 0;
  let skippedNoMatch = 0;
  let totalCandidates = 0;

  for (const wantedArtist of wantedArtists) {
    console.log(`\n=== ${wantedArtist} ===`);
    let candidates: SpotifyTrack[] = [];
    try {
      candidates = await searchTracksByArtist(token, wantedArtist);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.error(`  [QUOTA] aborting. Retry-After=${e.retryAfter}s`);
        break;
      }
      console.error(`  [ERR] ${(e as Error).message}`);
      continue;
    }
    totalCandidates += candidates.length;

    // Filter: track の artists に wantedArtist が含まれるもの
    const wantedNorm = normalizeArtistName(wantedArtist);
    const filtered = candidates.filter((t) =>
      t.artists.some((a) => {
        const an = normalizeArtistName(a.name);
        return an === wantedNorm || an.includes(wantedNorm) || wantedNorm.includes(an);
      }),
    );

    // Dedupe by track id (Spotify returns dupes across album versions)
    const seenId = new Set<string>();
    const unique = filtered.filter((t) => {
      if (seenId.has(t.id)) return false;
      seenId.add(t.id);
      return true;
    });
    console.log(
      `  candidates=${candidates.length}, filtered=${filtered.length}, unique=${unique.length}`,
    );

    // Cap per artist
    const targets = unique.slice(0, MAX_PER_ARTIST);

    // Resolve artist_id (DB の既存と照合 or 作成)
    let artistId: string | null =
      artistByNorm.get(wantedNorm)?.id ?? null;

    for (const t of targets) {
      // 候補の中で wantedArtist にマッチした artist 名を採用
      const matchedSpotifyName =
        t.artists.find((a) => {
          const an = normalizeArtistName(a.name);
          return an === wantedNorm || an.includes(wantedNorm) || wantedNorm.includes(an);
        })?.name ?? wantedArtist;

      const dupKey =
        normalizeArtistName(matchedSpotifyName) + "|" + normalizeTitle(t.name);
      if (existingSongKeys.has(dupKey)) {
        skippedDup++;
        continue;
      }
      // DB の既存 artist にも揺れマッチ判定
      const altDupKey = normalizeArtistName(wantedArtist) + "|" + normalizeTitle(t.name);
      if (existingSongKeys.has(altDupKey)) {
        skippedDup++;
        continue;
      }

      // artist 解決
      if (!artistId) {
        if (dryRun) {
          artistId = "<dry-new>";
        } else {
          const ins: ArtistInsert = {
            name: wantedArtist,
            name_norm: wantedNorm,
            genres: [],
          };
          const { data, error } = await supabase
            .from("artists")
            .insert(ins)
            .select("id, name")
            .single();
          if (error) {
            console.error(`  [ERR-ARTIST] ${wantedArtist}: ${error.message}`);
            continue;
          }
          artistId = data.id;
          artistByNorm.set(wantedNorm, { id: data.id, name: data.name });
        }
      }

      const album = t.album;
      const artworkLarge = album.images?.[0]?.url ?? null;
      const artworkMedium = album.images?.[1]?.url ?? artworkLarge;
      const artworkSmall = album.images?.[2]?.url ?? artworkMedium;
      const releaseYear = album.release_date
        ? parseInt(album.release_date.slice(0, 4), 10)
        : null;

      const songRow: SongInsert = {
        title: t.name,
        artist: wantedArtist,
        artist_id: artistId,
        release_year: releaseYear,
        image_url_large: artworkLarge,
        image_url_medium: artworkMedium,
        image_url_small: artworkSmall,
        duration_ms: t.duration_ms,
        spotify_track_id: t.id,
        spotify_popularity: t.popularity ?? null,
        spotify_preview_url: t.preview_url,
        spotify_explicit: t.explicit,
        spotify_isrc: t.external_ids?.isrc ?? null,
        is_popular: true,
        source_urls: [`https://open.spotify.com/track/${t.id}`],
      };

      if (dryRun) {
        console.log(`  [DRY-INS] ${t.name} | year=${releaseYear ?? "----"}`);
        inserted++;
      } else {
        const { error } = await supabase.from("songs").insert(songRow);
        if (error) {
          // Spotify track id unique 等の衝突ならスキップ
          if (
            error.message.includes("duplicate key") ||
            error.message.includes("unique")
          ) {
            skippedDup++;
            continue;
          }
          console.error(`  [ERR-INS] ${t.name}: ${error.message}`);
          continue;
        }
        console.log(`  [INS] ${t.name} | year=${releaseYear ?? "----"}`);
        inserted++;
        existingSongKeys.add(dupKey);
      }
    }
    if (targets.length === 0) skippedNoMatch++;
  }

  console.log("\n=== summary ===");
  console.log(
    JSON.stringify(
      { inserted, skippedDup, skippedNoMatch, totalCandidates },
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

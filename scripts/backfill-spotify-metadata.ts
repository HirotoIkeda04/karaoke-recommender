/**
 * spotify_track_id 付きで Spotify メタの一部が空のレコードを
 * `/v1/tracks/{id}` 単一 ID エンドポイントで補完する。
 *
 * 補完対象 (NULL なら埋める、既存値は触らない):
 *   - duration_ms
 *   - spotify_explicit
 *   - spotify_isrc
 *   - release_year (← Spotify の release_date から年だけ)
 *
 * 取れなくなったフィールド (新規アプリ向け制限 2024-2025):
 *   - /v1/tracks?ids= バッチエンドポイント (403)
 *   - /v1/artists/{id}/top-tracks (403)
 *
 * 背景: match-dam-songs.ts は spotify_track_id 1 カラムしか UPDATE
 * していなかったため、過去のマッチ済 ~2,500 曲のメタが空のまま残っていた。
 *
 * quota 戦略: 1 セッションで 400 件まで (Spotify quota 500/夜の安全圏内)。
 * 残りは翌夜以降に分割。
 *
 * 使い方:
 *   pnpm backfill:spotify-metadata --dry-run
 *   pnpm backfill:spotify-metadata
 *   pnpm backfill:spotify-metadata -- --max 200
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TRACK_URL = "https://api.spotify.com/v1/tracks";
const DEFAULT_MAX = 400;
const SLEEP_MS = 200;
const MAX_RETRY_AFTER_SEC = 120;

interface SongRow {
  id: string;
  spotify_track_id: string;
  duration_ms: number | null;
  spotify_explicit: boolean | null;
  spotify_isrc: string | null;
  release_year: number | null;
}

interface SpotifyTrack {
  id: string;
  duration_ms: number;
  popularity: number;
  preview_url: string | null;
  explicit: boolean;
  external_ids?: { isrc?: string };
  album: { release_date?: string; images?: Array<{ url: string }> };
}

class QuotaExceededError extends Error {
  constructor(public retryAfter: number) {
    super(`spotify quota (Retry-After=${retryAfterFmt(retryAfter)})`);
  }
}
function retryAfterFmt(s: number) {
  return s > 60 ? `${(s / 60).toFixed(1)}m` : `${s}s`;
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  let max = DEFAULT_MAX;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--max") max = parseInt(args[i + 1] ?? String(DEFAULT_MAX), 10);
  }
  return { dryRun, max };
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
  return ((await res.json()) as { access_token: string }).access_token;
}

async function fetchTrack(
  token: string,
  id: string,
): Promise<SpotifyTrack | null> {
  const url = `${SPOTIFY_TRACK_URL}/${id}?market=JP`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 429) {
    const ra = parseInt(res.headers.get("Retry-After") ?? "0", 10);
    if (ra > MAX_RETRY_AFTER_SEC) throw new QuotaExceededError(ra);
    await sleep(ra * 1000);
    return fetchTrack(token, id);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`track ${id} ${res.status}`);
  return (await res.json()) as SpotifyTrack;
}

async function main() {
  const { dryRun, max } = parseArgs();
  const supabase = createAdminClient();

  // spotify_track_id 付きで duration_ms または release_year が NULL のレコードを
  // 上限 max 件まで取得 (release_year 古い順 = 古い曲から埋める)。
  // 1 セッションで全部処理すると quota を踏むので上限制御。
  const { data, error } = await supabase
    .from("songs")
    .select(
      "id, spotify_track_id, duration_ms, spotify_explicit, spotify_isrc, release_year",
    )
    .not("spotify_track_id", "is", null)
    .or("duration_ms.is.null,spotify_explicit.is.null,spotify_isrc.is.null,release_year.is.null")
    .order("created_at", { ascending: true })
    .limit(max);
  if (error) throw error;
  const candidates = (data ?? []) as SongRow[];
  console.log(
    `candidates (limit ${max}): ${candidates.length}, dryRun=${dryRun}`,
  );
  if (candidates.length === 0) {
    console.log("nothing to do.");
    return;
  }

  const token = await getSpotifyToken();

  let updated = 0;
  let unchanged = 0;
  let errors = 0;
  let quotaHit = false;

  for (let i = 0; i < candidates.length; i++) {
    const orig = candidates[i];
    let track: SpotifyTrack | null = null;
    try {
      track = await fetchTrack(token, orig.spotify_track_id);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.error(
          `\n  [QUOTA] aborting at ${i}/${candidates.length}: ${e.message}`,
        );
        quotaHit = true;
        break;
      }
      console.error(`  [ERR] ${orig.spotify_track_id}: ${(e as Error).message}`);
      errors++;
      await sleep(SLEEP_MS);
      continue;
    }
    if (!track) {
      // 404 等
      unchanged++;
      await sleep(SLEEP_MS);
      continue;
    }
    const patch: SongUpdate = {};
    if (orig.duration_ms == null && track.duration_ms)
      patch.duration_ms = track.duration_ms;
    if (orig.spotify_explicit == null && track.explicit != null)
      patch.spotify_explicit = track.explicit;
    if (orig.spotify_isrc == null && track.external_ids?.isrc)
      patch.spotify_isrc = track.external_ids.isrc;
    if (orig.release_year == null && track.album?.release_date) {
      const y = parseInt(track.album.release_date.slice(0, 4), 10);
      if (Number.isFinite(y)) patch.release_year = y;
    }
    // popularity / preview_url は新規アプリ向け制限で取れないので touch しない
    if (Object.keys(patch).length === 0) {
      unchanged++;
      await sleep(SLEEP_MS);
      continue;
    }
    if (!dryRun) {
      const { error: uerr } = await supabase
        .from("songs")
        .update(patch)
        .eq("id", orig.id);
      if (uerr) {
        console.error(`  [ERR-UPD] ${orig.id}: ${uerr.message}`);
        errors++;
        await sleep(SLEEP_MS);
        continue;
      }
    }
    updated++;
    if ((i + 1) % 50 === 0) {
      console.log(
        `  progress: ${i + 1}/${candidates.length} (updated=${updated}, unchanged=${unchanged}, errors=${errors})`,
      );
    }
    await sleep(SLEEP_MS);
  }

  console.log(`\n=== summary ===`);
  console.log(JSON.stringify({ updated, unchanged, errors, quotaHit }, null, 2));
  console.log(`done (${dryRun ? "DRY-RUN" : "applied"}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

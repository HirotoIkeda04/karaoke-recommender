/**
 * `spotify_track_id` は入っているが `image_url_*` が NULL の曲を対象に、
 * Spotify GET /v1/tracks?ids=... で album.images / release_date を取得し DB を更新する。
 *
 * 背景:
 *   match-dam-songs.ts の旧版にバグがあり、bestRaw.album.images を読むつもりが
 *   実際には bestRaw.images がトップレベルに展開されていたため undefined となり、
 *   image_url_* / release_year が NULL のまま spotify_track_id だけが入った行が
 *   241 件発生した。バグ修正後の手当てとしてこのスクリプトで一括バックフィル。
 *
 * 実行: pnpm backfill:spotify-images
 *
 * 仕様:
 * - GET /v1/tracks/{id} を 1 件ずつ呼ぶ (Several Tracks /v1/tracks?ids=... は
 *   このアプリ tier で 403 Forbidden になるため。Single Track は 200)
 * - call 間隔 1.5s (match:dam と同じ保守的設定)
 * - 429 Retry-After > 120s で quota 超過とみなして停止
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

const SPOTIFY_INTERVAL_MS = 1500;
const MAX_RETRY_AFTER_SEC = 120;
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_TRACK_URL = "https://api.spotify.com/v1/tracks";

interface TargetSong {
  id: string;
  spotify_track_id: string;
  title: string;
}

interface SpotifyTrack {
  id: string;
  album?: {
    release_date?: string;
    images?: { url: string; height?: number; width?: number }[];
  };
}

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

  async getTrack(id: string): Promise<SpotifyTrack | null> {
    const params = new URLSearchParams({ market: "JP" });
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.ensureToken();
      const res = await fetch(`${SPOTIFY_TRACK_URL}/${id}?${params.toString()}`, {
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
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`track endpoint failed: ${res.status} ${await res.text()}`);
      return (await res.json()) as SpotifyTrack;
    }
    throw new Error(`track endpoint failed after retries: id=${id}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickImages(images: { url: string; height?: number }[] | undefined) {
  const arr = images ?? [];
  const sorted = [...arr].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const large = sorted.find((i) => (i.height ?? 0) >= 500) ?? sorted[0];
  const medium =
    sorted.find((i) => (i.height ?? 0) >= 200 && (i.height ?? 0) < 500) ??
    sorted[Math.floor(sorted.length / 2)];
  const small = [...sorted].reverse().find((i) => (i.height ?? 0) <= 200) ?? sorted[sorted.length - 1];
  return {
    image_url_large: large?.url ?? null,
    image_url_medium: medium?.url ?? null,
    image_url_small: small?.url ?? null,
  };
}

async function fetchTargets(): Promise<TargetSong[]> {
  const sb = createAdminClient();
  const PAGE = 1000;
  const acc: TargetSong[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("songs")
      .select("id, spotify_track_id, title")
      .not("spotify_track_id", "is", null)
      .is("image_url_small", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    acc.push(...(data as TargetSong[]));
    if (data.length < PAGE) break;
  }
  return acc;
}

async function main() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET");
    process.exit(1);
  }

  const targets = await fetchTargets();
  console.log(`targets (spotify_track_id IS NOT NULL AND image_url_small IS NULL): ${targets.length}`);
  if (targets.length === 0) {
    console.log("nothing to do.");
    return;
  }

  const client = new SpotifyClient(clientId, clientSecret);
  const sb = createAdminClient();

  let updated = 0;
  let imagesMissing = 0;
  let notFound = 0;
  let errors = 0;
  let quotaHit = false;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];

    let track: SpotifyTrack | null;
    try {
      track = await client.getTrack(t.spotify_track_id);
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        console.error(`spotify quota exceeded at ${i}/${targets.length} (retry_after=${e.retryAfterSec}s); stopping`);
        quotaHit = true;
        break;
      }
      throw e;
    }

    if (!track) {
      console.warn(`  not found on Spotify: ${t.title} (${t.spotify_track_id})`);
      notFound++;
    } else {
      const album = track.album ?? {};
      const imgs = pickImages(album.images);
      if (!imgs.image_url_large) {
        console.warn(`  no images: ${t.title} (${t.spotify_track_id})`);
        imagesMissing++;
      } else {
        const releaseYear = album.release_date ? parseInt(album.release_date.slice(0, 4), 10) : null;
        const update: SongUpdate = {
          image_url_large: imgs.image_url_large,
          image_url_medium: imgs.image_url_medium,
          image_url_small: imgs.image_url_small,
        };
        if (Number.isFinite(releaseYear)) update.release_year = releaseYear;

        const { error } = await sb.from("songs").update(update).eq("id", t.id);
        if (error) {
          console.error(`  update failed for ${t.title}:`, error.message);
          errors++;
        } else {
          updated++;
        }
      }
    }

    if ((i + 1) % 25 === 0 || i === targets.length - 1) {
      console.log(
        `  progress: ${i + 1}/${targets.length} ` +
        `updated=${updated} imagesMissing=${imagesMissing} notFound=${notFound} errors=${errors}`,
      );
    }

    if (i < targets.length - 1) {
      await sleep(SPOTIFY_INTERVAL_MS);
    }
  }

  console.log(
    `\ndone. updated=${updated} images_missing=${imagesMissing} not_found=${notFound} ` +
    `errors=${errors} quota_hit=${quotaHit}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

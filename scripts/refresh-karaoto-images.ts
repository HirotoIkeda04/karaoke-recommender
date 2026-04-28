/**
 * scraper/output/karaoto_itunes.json を読み、karaoto 由来 (= spotify_track_id を
 * natural key とする) の既存曲の画像を iTunes 由来に更新する。
 *
 * 実行: pnpm refresh:karaoto-images
 *
 * 仕様:
 * - spotify_track_id で行を特定 (この id は karaoto 由来曲のみが持つ)
 * - image_url_small/medium/large を iTunes URL に置き換え
 * - source_urls に iTunes URL を append (既存 URL 群は維持)
 * - itunes_release_year がある場合 release_year を上書き (シングル準拠の方が
 *   「曲の本当の発売年」に近いため)
 * - iTunes ヒット無し (track == null) の曲は触らない (従来の Spotify 画像維持)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

interface RefreshEntry {
  spotify_track_id: string;
  title: string;
  artist: string;
  image_url_small: string | null;
  image_url_medium: string | null;
  image_url_large: string | null;
  itunes_track_view_url: string | null;
  itunes_release_year: number | null;
  itunes_similarity: number | null;
}

interface RefreshFile {
  songs: RefreshEntry[];
  metadata: {
    scraped_at: string;
    total_count: number;
    iTunes_hits: number;
    iTunes_misses: number;
  };
}

async function main() {
  const path = resolve(process.cwd(), "scraper/output/karaoto_itunes.json");
  const data: RefreshFile = JSON.parse(readFileSync(path, "utf-8"));
  console.log(
    `loaded ${data.songs.length} entries (iTunes hits=${data.metadata.iTunes_hits}, misses=${data.metadata.iTunes_misses})`,
  );

  const supabase = createAdminClient();

  let updated = 0;
  let skippedNoMatch = 0;
  let skippedRowMissing = 0;
  let errors = 0;

  for (const [i, entry] of data.songs.entries()) {
    if (!entry.image_url_large) {
      skippedNoMatch++;
      continue;
    }

    // 対象行を取得 (source_urls をマージするため既存値が必要)
    const { data: existing, error: selErr } = await supabase
      .from("songs")
      .select("id, source_urls, release_year")
      .eq("spotify_track_id", entry.spotify_track_id)
      .maybeSingle();

    if (selErr) {
      console.error(`[${i + 1}] select failed for ${entry.title}:`, selErr);
      errors++;
      continue;
    }
    if (!existing) {
      skippedRowMissing++;
      continue;
    }

    const newUrls = new Set<string>(existing.source_urls ?? []);
    if (entry.itunes_track_view_url) newUrls.add(entry.itunes_track_view_url);

    const update: SongUpdate = {
      image_url_small: entry.image_url_small,
      image_url_medium: entry.image_url_medium,
      image_url_large: entry.image_url_large,
      source_urls: Array.from(newUrls),
    };
    // iTunes が release_year を持つなら更新 (シングル準拠の方が「曲の発売年」に近い)
    if (entry.itunes_release_year) {
      update.release_year = entry.itunes_release_year;
    }

    const { error: updErr } = await supabase
      .from("songs")
      .update(update)
      .eq("id", existing.id);
    if (updErr) {
      console.error(`[${i + 1}] update failed for ${entry.title}:`, updErr);
      errors++;
      continue;
    }
    updated++;

    if ((i + 1) % 100 === 0) {
      console.log(
        `  progress ${i + 1}/${data.songs.length}: updated=${updated} skipped=${skippedNoMatch + skippedRowMissing} errors=${errors}`,
      );
    }
  }

  console.log(
    `\ndone. updated=${updated} skipped_no_match=${skippedNoMatch} ` +
    `skipped_row_missing=${skippedRowMissing} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

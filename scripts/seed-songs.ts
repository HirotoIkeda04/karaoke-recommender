/**
 * scraper/output/songs_seed.json を読み込み、Supabase の songs テーブルへ upsert する。
 *
 * 実行: pnpm seed:songs
 *
 * 仕様:
 * - スプライ ID (`spotify_track_id`) を競合キーとした upsert(再実行で重複しない)
 * - is_popular は scraper の代表曲フラグ(現状 seed は featured のみ → 全件 true)
 * - バッチサイズ 100 で投入(PostgREST のリクエストサイズ制限を回避)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];

interface SeedRow {
  title: string;
  artist: string;
  release_year: number | null;
  range_low_midi: number | null;
  range_high_midi: number;
  falsetto_max_midi: number | null;
  spotify_track_id: string | null;
  image_url_large: string | null;
  image_url_medium: string | null;
  image_url_small: string | null;
  duration_ms: number | null;
  spotify_popularity: number | null;
  spotify_preview_url: string | null;
  spotify_explicit: boolean | null;
  spotify_isrc: string | null;
  source_urls: string[];
}

interface SeedFile {
  songs: SeedRow[];
  metadata: {
    scraped_at: string;
    total_count: number;
    sources: string[];
  };
}

const BATCH_SIZE = 100;

async function main() {
  const seedPath = resolve(
    process.cwd(),
    "scraper/output/songs_seed.json",
  );
  const seed: SeedFile = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(
    `loaded ${seed.songs.length} songs (scraped_at=${seed.metadata.scraped_at})`,
  );

  const supabase = createAdminClient();

  const rows: SongInsert[] = seed.songs
    .filter((s) => s.spotify_track_id !== null)
    .map((s) => ({
      title: s.title,
      artist: s.artist,
      release_year: s.release_year,
      range_low_midi: s.range_low_midi,
      range_high_midi: s.range_high_midi,
      falsetto_max_midi: s.falsetto_max_midi,
      spotify_track_id: s.spotify_track_id,
      image_url_large: s.image_url_large,
      image_url_medium: s.image_url_medium,
      image_url_small: s.image_url_small,
      duration_ms: s.duration_ms,
      spotify_popularity: s.spotify_popularity,
      spotify_preview_url: s.spotify_preview_url,
      spotify_explicit: s.spotify_explicit,
      spotify_isrc: s.spotify_isrc,
      source_urls: s.source_urls,
      is_popular: true,
    }));

  // 既存行が (title, artist) 同一・spotify_track_id=NULL の場合、
  // upsert(onConflict: spotify_track_id) では衝突しないので
  // 先にその行へ track_id を埋め込んでから upsert する。
  // PostgREST の 1000 行制限を回避するためページングで全件取得。
  const PAGE = 1000;
  const nullRowsAll: Array<{ id: string; title: string; artist: string }> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist")
      .is("spotify_track_id", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("failed to fetch null-track rows:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    nullRowsAll.push(...data);
    if (data.length < PAGE) break;
  }
  const nullByKey = new Map<string, string>(
    nullRowsAll.map((r) => [`${r.title}\t${r.artist}`, r.id]),
  );
  let preMerged = 0;
  for (const row of rows) {
    const id = nullByKey.get(`${row.title}\t${row.artist}`);
    if (!id) continue;
    const { error } = await supabase
      .from("songs")
      .update({
        spotify_track_id: row.spotify_track_id,
        release_year: row.release_year,
        range_low_midi: row.range_low_midi,
        range_high_midi: row.range_high_midi,
        falsetto_max_midi: row.falsetto_max_midi,
        image_url_large: row.image_url_large,
        image_url_medium: row.image_url_medium,
        image_url_small: row.image_url_small,
        duration_ms: row.duration_ms,
        spotify_popularity: row.spotify_popularity,
        spotify_preview_url: row.spotify_preview_url,
        spotify_explicit: row.spotify_explicit,
        spotify_isrc: row.spotify_isrc,
        source_urls: row.source_urls,
        is_popular: true,
      })
      .eq("id", id);
    if (error) {
      console.error(`pre-merge failed for ${row.title} / ${row.artist}:`, error);
      process.exit(1);
    }
    preMerged++;
  }
  if (preMerged > 0) {
    console.log(`pre-merged ${preMerged} rows into existing NULL-track entries`);
  }

  console.log(`upserting ${rows.length} rows in batches of ${BATCH_SIZE}...`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from("songs")
      .upsert(batch, {
        onConflict: "spotify_track_id",
        count: "exact",
      });
    if (error) {
      console.error(
        `batch ${i / BATCH_SIZE + 1} failed at rows ${i}-${i + batch.length}:`,
        error,
      );
      process.exit(1);
    }
    inserted += count ?? batch.length;
    console.log(`  batch ${i / BATCH_SIZE + 1}: +${batch.length} rows`);
  }

  // 投入後の総件数を確認
  const { count: total, error: countErr } = await supabase
    .from("songs")
    .select("*", { count: "exact", head: true });

  if (countErr) {
    console.error("post-insert count failed:", countErr);
    process.exit(1);
  }

  console.log(`done. upserted=${inserted}, table_total=${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

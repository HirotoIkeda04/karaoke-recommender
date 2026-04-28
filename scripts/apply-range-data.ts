/**
 * scraper/output/range_results.json を読み、range_low/high/falsetto を
 * songs テーブルに UPDATE する。
 *
 * 実行: pnpm apply:range
 *
 * 仕様:
 *  - id で行を特定 (Supabase songs.id を直接保存)
 *  - 既存値が NULL の項目だけ書き換える (重ね当ては避ける)
 *  - source_urls に 音域ソース URL を append
 *  - incremental 実行 OK (既反映の曲は同じ値で no-op)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

interface RangeEntry {
  id: string;
  title: string | null;
  artist: string | null;
  release_year: number | null;
  range_low_midi: number | null;
  range_high_midi: number | null;
  falsetto_max_midi: number | null;
  source: string;
  source_url: string;
  similarity: number;
}

interface RangeFile {
  songs: RangeEntry[];
  metadata: {
    scraped_at: string;
    applied_count: number;
    tried_total: number;
  };
}

async function main() {
  const path = resolve(process.cwd(), "scraper/output/range_results.json");
  const data: RangeFile = JSON.parse(readFileSync(path, "utf-8"));
  console.log(
    `loaded ${data.songs.length} entries (tried_total=${data.metadata.tried_total})`,
  );

  const supabase = createAdminClient();

  let updated = 0;
  let skippedRowMissing = 0;
  let errors = 0;

  for (const [i, entry] of data.songs.entries()) {
    if (entry.range_high_midi === null) continue;

    // 既存行を取得 (NULL チェック + source_urls マージ用)
    const { data: existing, error: selErr } = await supabase
      .from("songs")
      .select("id, range_low_midi, range_high_midi, falsetto_max_midi, source_urls")
      .eq("id", entry.id)
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

    const update: SongUpdate = {};
    if (existing.range_low_midi === null && entry.range_low_midi !== null) {
      update.range_low_midi = entry.range_low_midi;
    }
    if (existing.range_high_midi === null && entry.range_high_midi !== null) {
      update.range_high_midi = entry.range_high_midi;
    }
    if (existing.falsetto_max_midi === null && entry.falsetto_max_midi !== null) {
      update.falsetto_max_midi = entry.falsetto_max_midi;
    }

    // source_urls に音域ソース URL を追加
    const newUrls = new Set(existing.source_urls ?? []);
    if (entry.source_url) newUrls.add(entry.source_url);
    if (newUrls.size !== (existing.source_urls?.length ?? 0)) {
      update.source_urls = Array.from(newUrls);
    }

    if (Object.keys(update).length === 0) {
      // 全項目既に埋まっている等
      continue;
    }

    const { error: updErr } = await supabase
      .from("songs")
      .update(update)
      .eq("id", entry.id);
    if (updErr) {
      console.error(`[${i + 1}] update failed for ${entry.title}:`, updErr);
      errors++;
      continue;
    }
    updated++;

    if ((i + 1) % 100 === 0) {
      console.log(
        `  progress ${i + 1}/${data.songs.length}: updated=${updated} errors=${errors}`,
      );
    }
  }

  console.log(
    `\ndone. updated=${updated} skipped_row_missing=${skippedRowMissing} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

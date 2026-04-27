/**
 * scraper/output/dam_songs.json を読み込み、Supabase の songs テーブルへ
 * find-or-insert で投入する。
 *
 * 実行: pnpm seed:dam
 *
 * 仕様:
 * - dam_request_no を一意キーとして upsert(2 回目以降は冪等)
 * - DAM 曲は基本的に音域(range_*_midi)情報を持たない → NULL のまま投入
 * - iTunes でマッチした曲はジャケ + release_year が埋まる
 * - 既存 spotify 由来曲との (title, artist) 重複は将来の dedup ジョブで処理
 *   (ここでは挿入時点で名寄せしない: 同名異曲の判別は人手必要)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];

interface DamSeedRow {
  title: string;
  artist: string;
  dam_request_no: string;
  source_pages: string[];
  release_year: number | null;
  image_url_small: string | null;
  image_url_medium: string | null;
  image_url_large: string | null;
  itunes_track_view_url: string | null;
  itunes_similarity: number | null;
}

interface SeedFile {
  songs: DamSeedRow[];
  metadata: {
    scraped_at: string;
    total_count: number;
    sources: string[];
  };
}

const BATCH_SIZE = 100;

function buildSourceUrls(s: DamSeedRow): string[] {
  const urls: string[] = [
    `https://www.clubdam.com/karaokesearch/songleaf.html?requestNo=${s.dam_request_no}`,
  ];
  if (s.itunes_track_view_url) urls.push(s.itunes_track_view_url);
  return urls;
}

async function main() {
  const seedPath = resolve(
    process.cwd(),
    "scraper/output/dam_songs.json",
  );
  const seed: SeedFile = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(
    `loaded ${seed.songs.length} DAM songs (scraped_at=${seed.metadata.scraped_at})`,
  );

  const supabase = createAdminClient();

  const rows: SongInsert[] = seed.songs.map((s) => ({
    title: s.title,
    artist: s.artist,
    release_year: s.release_year,
    range_low_midi: null,
    range_high_midi: null,
    falsetto_max_midi: null,
    spotify_track_id: null,
    image_url_large: s.image_url_large,
    image_url_medium: s.image_url_medium,
    image_url_small: s.image_url_small,
    source_urls: buildSourceUrls(s),
    is_popular: true,
    // dam_request_no は migration 005 で追加された新列。型再生成前なので as any。
    dam_request_no: s.dam_request_no,
    match_status: "pending",
  } as SongInsert & {
    dam_request_no: string;
    match_status: "pending";
  }));

  const itunesHits = seed.songs.filter((s) => s.image_url_large !== null).length;
  console.log(
    `enrichment: iTunes hit ${itunesHits}/${seed.songs.length} (${
      ((itunesHits / seed.songs.length) * 100).toFixed(1)
    }%)`,
  );

  console.log(`upserting ${rows.length} rows in batches of ${BATCH_SIZE}...`);

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error, count } = await supabase
      .from("songs")
      .upsert(batch, {
        onConflict: "dam_request_no",
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

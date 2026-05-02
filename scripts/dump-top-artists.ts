// ============================================================================
// 関連アーティスト生成のための入力ダンプ
// ============================================================================
// artists_with_song_count から song_count 上位 N 件を JSON で吐く。
// 出力 → scraper/output/top_artists.json
// ----------------------------------------------------------------------------
//   pnpm dump:top-artists --limit 200
// ============================================================================

import { writeFileSync } from "node:fs";
import path from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 200;

async function main() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("artists_with_song_count")
    .select("id, name, genres, song_count")
    .order("song_count", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (error) throw error;
  const rows = (data ?? []).filter((r) => r.id && r.name);

  const outPath = path.resolve("scraper/output/top_artists.json");
  writeFileSync(
    outPath,
    JSON.stringify({ generated_at: new Date().toISOString(), limit: LIMIT, artists: rows }, null, 2),
  );
  console.log(`wrote ${rows.length} artists → ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

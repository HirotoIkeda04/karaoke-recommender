/**
 * scraper/output/fame_cache.jsonl を読み、fame_score / fame_article / fame_views を
 * songs テーブルに UPDATE する。
 *
 * 実行: pnpm apply:fame
 *
 * 仕様:
 *  - (title, artist) で行を特定。重複ヒット時は全行に同じスコアを書く。
 *  - cache が無い行は触らない (= fame_score を NULL のまま残す)
 *  - 値の更新は冪等。再実行しても同じ結果になる。
 *  - cache に対応する DB 行が無い場合は警告して継続 (DAM seed と cache の同期ずれ用)。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

interface FameCacheEntry {
  title: string;
  artist: string;
  article: string | null;
  total_views: number;
  fame_score: number;
}

function loadCache(path: string): FameCacheEntry[] {
  const text = readFileSync(path, "utf-8");
  const entries: FameCacheEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch (e) {
      console.warn(`skip malformed cache line: ${trimmed.slice(0, 100)}`);
    }
  }
  return entries;
}

async function main() {
  const cachePath = resolve(
    process.cwd(),
    "scraper/output/fame_cache.jsonl",
  );
  const cache = loadCache(cachePath);
  console.log(`loaded ${cache.length} cache entries`);

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  let updated = 0;
  let songsMissing = 0;
  let errors = 0;

  for (const [i, entry] of cache.entries()) {
    // (title, artist) で songs を引く。重複は許容して全部更新。
    const { data: rows, error: selErr } = await supabase
      .from("songs")
      .select("id")
      .eq("title", entry.title)
      .eq("artist", entry.artist);

    if (selErr) {
      console.error(`[${i + 1}] select failed for ${entry.title} / ${entry.artist}:`, selErr);
      errors++;
      continue;
    }
    if (!rows || rows.length === 0) {
      songsMissing++;
      continue;
    }

    const ids = rows.map((r) => r.id);
    const { error: updErr } = await supabase
      .from("songs")
      .update({
        fame_score: entry.fame_score,
        fame_article: entry.article,
        fame_views: entry.total_views,
        fame_updated_at: now,
      })
      .in("id", ids);

    if (updErr) {
      console.error(`[${i + 1}] update failed for ${entry.title}:`, updErr);
      errors++;
      continue;
    }
    updated += ids.length;

    if ((i + 1) % 100 === 0) {
      console.log(
        `  progress ${i + 1}/${cache.length}: updated_rows=${updated} ` +
          `songs_missing=${songsMissing} errors=${errors}`,
      );
    }
  }

  console.log(
    `\ndone. cache_entries=${cache.length} updated_rows=${updated} ` +
      `songs_missing=${songsMissing} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

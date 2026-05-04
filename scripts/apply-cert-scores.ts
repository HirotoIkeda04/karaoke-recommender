/**
 * scraper/output/cert_cache.jsonl を読み、cert_score / cert_label を
 * songs テーブルに UPDATE する。
 *
 * 実行: pnpm apply:cert
 *
 * 仕様:
 *  - (title, artist) で行を特定。重複ヒット時は全行に同じスコアを書く。
 *  - cache が無い行は触らない (= cert_score を NULL のまま残す)
 *  - 値の更新は冪等。再実行しても同じ結果になる。
 *  - apply-fame-scores.ts と同じパターン。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

interface CertCacheEntry {
  title: string;
  artist: string;
  article: string | null;
  cert_score: number;
  cert_label: string;
}

function loadCache(path: string): CertCacheEntry[] {
  const text = readFileSync(path, "utf-8");
  const entries: CertCacheEntry[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed));
    } catch {
      console.warn(`skip malformed cache line: ${trimmed.slice(0, 100)}`);
    }
  }
  return entries;
}

async function main() {
  const cachePath = resolve(process.cwd(), "scraper/output/cert_cache.jsonl");
  const cache = loadCache(cachePath);
  console.log(`loaded ${cache.length} cert cache entries`);

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  let updated = 0;
  let songsMissing = 0;
  let errors = 0;

  for (const [i, entry] of cache.entries()) {
    const { data: rows, error: selErr } = await supabase
      .from("songs")
      .select("id")
      .eq("title", entry.title)
      .eq("artist", entry.artist);

    if (selErr) {
      console.error(
        `[${i + 1}] select failed for ${entry.title} / ${entry.artist}:`,
        selErr,
      );
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
        cert_score: entry.cert_score,
        cert_label: entry.cert_label || null,
        cert_updated_at: now,
      })
      .in("id", ids);

    if (updErr) {
      console.error(`[${i + 1}] update failed for ${entry.title}:`, updErr);
      errors++;
      continue;
    }
    updated += ids.length;

    if ((i + 1) % 200 === 0) {
      console.log(
        `  progress ${i + 1}/${cache.length}: updated_rows=${updated} ` +
          `songs_missing=${songsMissing} errors=${errors}`,
      );
    }
  }

  const certPositive = cache.filter((e) => e.cert_score > 0).length;
  console.log(
    `\ndone. cache_entries=${cache.length} (cert>0: ${certPositive}) ` +
      `updated_rows=${updated} songs_missing=${songsMissing} errors=${errors}`,
  );
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

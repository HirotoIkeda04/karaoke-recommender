/**
 * scraper/output/karaoke_scores.jsonl の予測スコアを songs に反映する。
 *
 * 実行:
 *   pnpm apply:karaoke --dry-run
 *   pnpm apply:karaoke
 *
 * title / artist の表記ゆれを避けるため、song_id の完全一致だけで更新する。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

interface KaraokeScoreEntry {
  song_id: string;
  karaoke_score: number;
}

const PAGE_SIZE = 1000;

function parseArgs() {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

function loadScores(path: string): KaraokeScoreEntry[] {
  const text = readFileSync(path, "utf8");
  const entries: KaraokeScoreEntry[] = [];
  const seenIds = new Set<string>();

  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const raw: unknown = JSON.parse(trimmed);
    if (!raw || typeof raw !== "object") {
      throw new Error(`line ${index + 1}: object expected`);
    }
    const keys = Object.keys(raw).sort().join(",");
    if (keys !== "karaoke_score,song_id") {
      throw new Error(
        `line ${index + 1}: only song_id and karaoke_score are allowed`,
      );
    }
    const { song_id, karaoke_score } = raw as Record<string, unknown>;
    if (typeof song_id !== "string" || song_id.length === 0) {
      throw new Error(`line ${index + 1}: invalid song_id`);
    }
    if (
      typeof karaoke_score !== "number" ||
      !Number.isFinite(karaoke_score) ||
      karaoke_score < 0 ||
      karaoke_score > 1
    ) {
      throw new Error(`line ${index + 1}: karaoke_score must be within 0..1`);
    }
    if (seenIds.has(song_id)) {
      throw new Error(`line ${index + 1}: duplicate song_id ${song_id}`);
    }
    seenIds.add(song_id);
    entries.push({ song_id, karaoke_score });
  }
  return entries;
}

async function main() {
  const { dryRun } = parseArgs();
  const scoresPath = resolve(
    process.cwd(),
    "scraper/output/karaoke_scores.jsonl",
  );
  const entries = loadScores(scoresPath);
  const supabase = createAdminClient();
  let matched = 0;
  let missing = 0;
  let errors = 0;

  console.log(`loaded ${entries.length} prediction scores${dryRun ? " (dry-run)" : ""}`);
  if (dryRun) {
    const databaseIds = new Set<string>();
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("songs")
        .select("id")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`songs validation failed at ${from}: ${error.message}`);
      for (const row of data ?? []) databaseIds.add(row.id);
      if (!data || data.length < PAGE_SIZE) break;
    }
    matched = entries.filter((entry) => databaseIds.has(entry.song_id)).length;
    missing = entries.length - matched;
    console.log(
      `done. predictions=${entries.length} would_update=${matched} ` +
        `missing=${missing} errors=0`,
    );
    if (missing > 0) process.exit(1);
    return;
  }

  for (const [index, entry] of entries.entries()) {
    const { data, error } = await supabase
      .from("songs")
      .update({ karaoke_score: entry.karaoke_score })
      .eq("id", entry.song_id)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error(`[${index + 1}] update failed for ${entry.song_id}:`, error);
      errors += 1;
    } else if (!data) {
      missing += 1;
    } else {
      matched += 1;
    }

    if ((index + 1) % 500 === 0) {
      console.log(
        `  progress ${index + 1}/${entries.length}: matched=${matched} ` +
          `missing=${missing} errors=${errors}`,
      );
    }
  }

  console.log(
    `done. predictions=${entries.length} updated=${matched} ` +
      `missing=${missing} errors=${errors}`,
  );
  if (missing > 0 || errors > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

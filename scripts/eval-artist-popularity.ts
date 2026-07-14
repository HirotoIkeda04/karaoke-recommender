/**
 * アーティストページの「人気の楽曲」が手動ゴールデン条件を満たすか検証する。
 *
 * ゴールデンは外部ランキングの順位を書き写したものではなく、表示回帰を防ぐ
 * 包含条件だけを保持する。実ページと同じ max(fame_score, cert_score) を使う。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

interface GoldenCase {
  artist: string;
  limit: number;
  required_top_titles: string[];
}

const GOLDEN_PATH = resolve(
  process.cwd(),
  "scripts/artist-popularity-golden.json",
);

function popularityScore(song: {
  fame_score: number | null;
  cert_score: number | null;
}) {
  return Math.max(song.fame_score ?? 0, song.cert_score ?? 0);
}

async function main() {
  const golden = JSON.parse(
    readFileSync(GOLDEN_PATH, "utf8"),
  ) as GoldenCase[];
  const supabase = createAdminClient();
  let failures = 0;

  for (const testCase of golden) {
    const { data: artists, error: artistError } = await supabase
      .from("artists")
      .select("id, name")
      .eq("name", testCase.artist);
    if (artistError) throw artistError;
    if (!artists || artists.length !== 1) {
      console.error(
        `[FAIL] ${testCase.artist}: expected one artist, found ${artists?.length ?? 0}`,
      );
      failures++;
      continue;
    }

    const { data: songs, error: songsError } = await supabase
      .from("songs")
      .select("title, fame_score, cert_score")
      .eq("artist_id", artists[0].id);
    if (songsError) throw songsError;

    const top = (songs ?? [])
      .filter((song) => popularityScore(song) > 0)
      .sort((a, b) => {
        const scoreDifference = popularityScore(b) - popularityScore(a);
        return scoreDifference || a.title.localeCompare(b.title, "ja");
      })
      .slice(0, testCase.limit);
    const topTitles = new Set(top.map((song) => song.title));
    const missing = testCase.required_top_titles.filter(
      (title) => !topTitles.has(title),
    );

    console.log(`\n${testCase.artist} top ${testCase.limit}`);
    top.forEach((song, index) => {
      console.log(
        `  ${index + 1}. ${song.title} ` +
          `(fame=${song.fame_score ?? "NULL"}, cert=${song.cert_score ?? "NULL"})`,
      );
    });
    if (missing.length > 0) {
      console.error(`[FAIL] missing required titles: ${missing.join(", ")}`);
      failures++;
    } else {
      console.log("[PASS] required titles are present");
    }
  }

  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

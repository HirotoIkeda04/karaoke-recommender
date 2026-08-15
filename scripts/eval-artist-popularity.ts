/**
 * アーティストページの「人気の楽曲」が手動ゴールデン条件を満たすか検証する。
 *
 * ゴールデンは外部ランキングの順位を書き写したものではなく、表示回帰を防ぐ
 * 条件だけを保持する。実ページと同じ max(fame_score, cert_score) を使う。
 *
 * 条件は 2 種類:
 *   required_top_titles  上位 limit 件に必ず含まれるべき曲
 *   required_order       [上位であるべき曲, 下位であるべき曲] の組。全順位を
 *                        書き下すと主観が入りすぎるため、自信のある 2 曲間の
 *                        大小だけを宣言する。判定は limit 件ではなくリスト
 *                        全体に対して行う。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

interface GoldenCase {
  artist: string;
  limit: number;
  required_top_titles: string[];
  required_order?: Array<[string, string]>;
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

    const ranked = (songs ?? [])
      .filter((song) => popularityScore(song) > 0)
      .sort((a, b) => {
        const scoreDifference = popularityScore(b) - popularityScore(a);
        return scoreDifference || a.title.localeCompare(b.title, "ja");
      });
    const top = ranked.slice(0, testCase.limit);
    const topTitles = new Set(top.map((song) => song.title));
    const missing = testCase.required_top_titles.filter(
      (title) => !topTitles.has(title),
    );

    // 順位そのものではなく 2 曲間の大小だけを見る。片方がランク外に落ちて
    // いる場合も「上下が保証されていない」として失格にする。
    const rankByTitle = new Map(ranked.map((song, index) => [song.title, index]));
    const orderViolations: string[] = [];
    for (const [higher, lower] of testCase.required_order ?? []) {
      const higherRank = rankByTitle.get(higher);
      const lowerRank = rankByTitle.get(lower);
      if (higherRank === undefined || lowerRank === undefined) {
        const unranked = [
          higherRank === undefined ? higher : null,
          lowerRank === undefined ? lower : null,
        ].filter(Boolean);
        orderViolations.push(`${higher} > ${lower} (未ランク: ${unranked.join(", ")})`);
        continue;
      }
      if (higherRank >= lowerRank) {
        orderViolations.push(
          `${higher} > ${lower} (実際は ${higherRank + 1} 位 vs ${lowerRank + 1} 位)`,
        );
      }
    }

    console.log(`\n${testCase.artist} top ${testCase.limit}`);
    top.forEach((song, index) => {
      console.log(
        `  ${index + 1}. ${song.title} ` +
          `(fame=${song.fame_score ?? "NULL"}, cert=${song.cert_score ?? "NULL"})`,
      );
    });
    if (missing.length > 0) {
      console.error(`[FAIL] missing required titles: ${missing.join(", ")}`);
    }
    if (orderViolations.length > 0) {
      console.error(`[FAIL] order violations: ${orderViolations.join(" / ")}`);
    }
    if (missing.length > 0 || orderViolations.length > 0) {
      failures++;
    } else {
      console.log("[PASS] required titles and order are satisfied");
    }
  }

  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

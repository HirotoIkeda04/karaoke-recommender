// ============================================================================
// 重複アーティストの手動マージ (一回限り)
// ============================================================================
// scripts/find-dup-artists.ts で検出した 4 組を、
//   songs.artist_id 付け替え → genres union → 重複側 DELETE
// の順でマージする。
// ============================================================================

import { createAdminClient } from "@/lib/supabase/admin";

// winnerId に loserIds をマージ
const MERGES: { winnerId: string; loserIds: string[]; label: string }[] = [
  {
    label: "Mrs. GREEN APPLE",
    winnerId: "23d3d346-08f0-42e9-a95a-0f0c75f2dbbe",
    loserIds: ["d1e6dc33-265e-4bbc-812b-9feca7f1a30d"],
  },
  {
    label: "秦基博",
    winnerId: "b3de109d-e64e-435f-8bce-0d8d173f44ac",
    loserIds: ["0fd0de96-a6e5-4092-bf36-b9be68ee9381"],
  },
  {
    label: "藤井 風",
    winnerId: "64514bee-5469-4c05-a6d9-4b9b9c7dbc09",
    loserIds: ["a749d333-19a0-4812-a7dd-eb3b8f8aa8ba"],
  },
  {
    label: "嵐",
    winnerId: "1834b581-1105-46fe-9795-7ed797d7400a",
    loserIds: ["86f49c07-d093-45ae-88e7-35b0ce25d7bd"],
  },
];

async function main() {
  const supabase = createAdminClient();

  for (const { winnerId, loserIds, label } of MERGES) {
    console.log(`\n[${label}] winner=${winnerId} losers=${loserIds.join(",")}`);

    // 1. genres を union (winner + losers)
    const { data: rows, error: fetchErr } = await supabase
      .from("artists")
      .select("id, name, genres")
      .in("id", [winnerId, ...loserIds]);
    if (fetchErr) throw fetchErr;
    const winner = rows?.find((r) => r.id === winnerId);
    if (!winner) throw new Error(`winner not found: ${winnerId}`);

    const merged = new Set<string>(winner.genres ?? []);
    for (const r of rows ?? []) {
      if (r.id === winnerId) continue;
      for (const g of r.genres ?? []) merged.add(g);
    }
    const mergedGenres = [...merged].sort();
    console.log(`  union genres: ${JSON.stringify(mergedGenres)}`);

    // 2. songs.artist_id を winner に付け替え
    const { count: songCount, error: updErr } = await supabase
      .from("songs")
      .update({ artist_id: winnerId }, { count: "exact" })
      .in("artist_id", loserIds);
    if (updErr) throw updErr;
    console.log(`  reassigned songs: ${songCount}`);

    // 3. winner の genres を union 結果で更新
    const { error: genreErr } = await supabase
      .from("artists")
      .update({ genres: mergedGenres })
      .eq("id", winnerId);
    if (genreErr) throw genreErr;

    // 4. loser を削除
    const { error: delErr } = await supabase
      .from("artists")
      .delete()
      .in("id", loserIds);
    if (delErr) throw delErr;
    console.log(`  deleted ${loserIds.length} loser row(s)`);
  }

  console.log("\nAll merges complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ============================================================================
// related_artists.json → DB 取り込み
// ============================================================================
// 実行:
//   pnpm ingest:related-artists           # 通常実行
//   pnpm ingest:related-artists --dry     # ドライラン (DB 書き込みなし)
//
// 流れ:
//   1. scraper/output/related_artists.json を読む
//   2. artists テーブルから (id, name_norm) の辞書を作る
//   3. 各 (起点名, 関連名[]) ペアを正規化してマッチング
//   4. ヒットしたペアを related_artists に upsert (rank = 配列順)
//
// マッチしなかった名前は dropped としてレポート (DB に存在しないアーティスト)。
// ============================================================================

import { readFileSync } from "node:fs";
import path from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";

const DRY = process.argv.includes("--dry");

type RelatedJson = {
  related: Record<string, string[]>;
};

function normalize(name: string): string {
  // migrations/033 の normalize_artist_name と同じロジックを TS で再現
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s.\-_,!?'"・/\\()（）「」『』【】]+/g, "");
}

async function main() {
  const jsonPath = path.resolve("scraper/output/related_artists.json");
  const raw = readFileSync(jsonPath, "utf8");
  const data: RelatedJson = JSON.parse(raw);

  const supabase = createAdminClient();

  // 全アーティストの (name_norm → id) マップを作る
  const idByNorm = new Map<string, string>();
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: rows, error } = await supabase
      .from("artists")
      .select("id, name_norm")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!rows || rows.length === 0) break;
    for (const r of rows) {
      if (r.name_norm) idByNorm.set(r.name_norm, r.id);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  console.log(`loaded ${idByNorm.size} artists from DB`);

  type Pair = { artist_id: string; related_artist_id: string; rank: number };
  const pairs: Pair[] = [];
  const droppedSource: string[] = [];
  const droppedRelated: { source: string; missing: string[] }[] = [];

  for (const [sourceName, relList] of Object.entries(data.related)) {
    const sourceId = idByNorm.get(normalize(sourceName));
    if (!sourceId) {
      droppedSource.push(sourceName);
      continue;
    }
    const missing: string[] = [];
    // 表記ゆれ ("MISIA" と "Misia" など) で同じ artist_id に潰れた場合、
    // 重複は最初に出てきた rank で残す。
    const seen = new Set<string>();
    let rank = 1;
    for (const relName of relList) {
      const relId = idByNorm.get(normalize(relName));
      if (!relId) {
        missing.push(relName);
        continue;
      }
      if (relId === sourceId) continue; // 自己参照は skip
      if (seen.has(relId)) continue;
      seen.add(relId);
      pairs.push({ artist_id: sourceId, related_artist_id: relId, rank });
      rank += 1;
    }
    if (missing.length > 0) droppedRelated.push({ source: sourceName, missing });
  }

  console.log(`pairs to upsert: ${pairs.length}`);
  console.log(`source artists not found in DB: ${droppedSource.length}`);
  if (droppedSource.length > 0) console.log(droppedSource.join(", "));

  const totalMissingRel = droppedRelated.reduce((s, x) => s + x.missing.length, 0);
  console.log(`related artists not found in DB: ${totalMissingRel}`);
  // missing details (上位 20 件のみ詳細表示)
  for (const d of droppedRelated.slice(0, 20)) {
    console.log(`  ${d.source} → drop: ${d.missing.join(", ")}`);
  }
  if (droppedRelated.length > 20) {
    console.log(`  ... (+${droppedRelated.length - 20} more sources with drops)`);
  }

  if (DRY) {
    console.log("DRY RUN — skipping DB writes");
    return;
  }

  // related_artists は migration 036 で追加された新規テーブル。
  // この時点では DB types が再生成されていない可能性があるため `as any` で cast。
  // 既存の related_artists を全消し → 入れ直し (rank 整合性のため)
  // 起点 artist_id ごとに削除すれば「JSON にある起点だけ更新、他は残す」もできるが、
  // 今回は完全リプレース。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tbl = (supabase as any).from("related_artists");
  const sourceIds = [...new Set(pairs.map((p) => p.artist_id))];
  for (let i = 0; i < sourceIds.length; i += 100) {
    const batch = sourceIds.slice(i, i + 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from("related_artists")
      .delete()
      .in("artist_id", batch);
    if (error) throw error;
  }
  console.log(`cleared related_artists for ${sourceIds.length} source artists`);

  // バッチで upsert
  const BATCH = 500;
  for (let i = 0; i < pairs.length; i += BATCH) {
    const slice = pairs.slice(i, i + BATCH);
    const { error } = await tbl.upsert(slice, {
      onConflict: "artist_id,related_artist_id",
    });
    if (error) throw error;
    console.log(`upserted ${Math.min(i + BATCH, pairs.length)} / ${pairs.length}`);
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

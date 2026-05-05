/**
 * 既に DB に挿入済の wikidata_qid 楽曲の P31 (instance of) 分布を集計し、
 * "songs ではないもの" を特定する監査スクリプト。
 *
 * 結果は stdout に分布として出力するのみ (削除はしない)。
 * 削除は別スクリプトで明示的に。
 *
 * 使い方:
 *   pnpm audit:wikidata-types
 */
import { createAdminClient } from "../src/lib/supabase/admin";

const SPARQL = "https://query.wikidata.org/sparql";
const UA =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const BATCH = 50;
const SLEEP_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const supabase = createAdminClient();

  // 全 wikidata_qid を取得 (1000 行ページング)。
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("wikidata_qid")
      .not("wikidata_qid", "is", null)
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as Array<{ wikidata_qid: string }>;
    for (const r of rows) if (r.wikidata_qid) ids.push(r.wikidata_qid);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  console.log(`total wikidata_qid songs: ${ids.length}`);

  // P31 を batch でフェッチ。
  const typeByQ = new Map<string, string[]>();
  const labelByType = new Map<string, string>();

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const values = batch.map((q) => `wd:${q}`).join(" ");
    const sparql = `
      SELECT ?item ?p31 ?p31Label WHERE {
        VALUES ?item { ${values} }
        ?item wdt:P31 ?p31.
        SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
      }
    `;
    const url = `${SPARQL}?query=${encodeURIComponent(sparql)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) {
      console.error(`  batch ${i}: ${res.status}`);
      await sleep(5000);
      continue;
    }
    const json = (await res.json()) as {
      results: {
        bindings: Array<{
          item: { value: string };
          p31: { value: string };
          p31Label?: { value: string };
        }>;
      };
    };
    for (const b of json.results.bindings) {
      const q = b.item.value.split("/").pop()!;
      const t = b.p31.value.split("/").pop()!;
      const list = typeByQ.get(q) ?? [];
      list.push(t);
      typeByQ.set(q, list);
      if (b.p31Label && !labelByType.has(t)) {
        labelByType.set(t, b.p31Label.value);
      }
    }

    if ((i / BATCH) % 10 === 0) {
      console.log(`  progress: ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
    }
    await sleep(SLEEP_MS);
  }

  // 分布集計 (1 つの song に複数 P31 がある場合は全部カウント)。
  const counts = new Map<string, number>();
  for (const [, types] of typeByQ) {
    for (const t of types) {
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  console.log("\n=== P31 distribution (top 50) ===");
  console.log("Q-ID\tcount\tlabel");
  for (const [t, c] of sorted.slice(0, 50)) {
    console.log(`${t}\t${c}\t${labelByType.get(t) ?? "?"}`);
  }

  // P31 を 1 つも持たない song も検出。
  const noP31 = ids.filter((q) => !typeByQ.has(q));
  console.log(`\nno P31 (or fetch failed): ${noP31.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

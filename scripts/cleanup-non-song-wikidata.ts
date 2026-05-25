/**
 * Wikidata 由来で挿入された songs のうち、P31 (instance of) が
 * 楽曲系の whitelist に該当しないものを削除する。
 *
 * audit-wikidata-types.ts で観測された汚染パターン:
 *   - ビデオアルバム (Q10590726): ライブ DVD など
 *   - コンサートツアー (Q1573906)
 *   - 演奏会 (Q182832)
 *   - コンパクト盤 (Q169930): アルバム単位
 *   - 映画 (Q11424), 登場人物系, ディスコグラフィ etc.
 *
 * 判定ルール:
 *   - 全 P31 を取得し、SONG_WHITELIST に **1 つでも該当すればキープ**
 *   - 1 つも該当しなければ DELETE
 *   - P31 が取れなかった (35 件程度) ものはキープ (保守的)
 *
 * 使い方:
 *   pnpm cleanup:non-song-wikidata --dry-run   # 削除候補一覧のみ
 *   pnpm cleanup:non-song-wikidata             # DELETE 実行
 *   pnpm cleanup:non-song-wikidata --force     # 評価付き非楽曲も強制削除
 *
 * 安全策: 削除候補に評価 (evaluations) が付いている場合、既定ではその曲を
 * 削除せずスキップする (cascade でユーザー評価が消えるのを防ぐ)。
 * 意図的に消す場合のみ --force を指定する。
 */
import { createAdminClient } from "../src/lib/supabase/admin";
import { countEvaluationsForSongs } from "./lib/merge-song-refs";

const SPARQL = "https://query.wikidata.org/sparql";
const UA =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const BATCH = 50;
const SLEEP_MS = 800;

// 楽曲として扱う P31 の集合 (whitelist)。
// 1 つでも該当すれば「楽曲」とみなしてキープ。
const SONG_WHITELIST = new Set<string>([
  "Q134556",       // シングル
  "Q105543609",    // 音楽作品/楽曲
  "Q7366",         // 歌
  "Q55850593",     // ヴォーカルを伴う楽曲
  "Q7302866",      // オーディオトラック
  "Q66021463",     // 両A面シングル
  "Q108352496",    // シングルリリース
  "Q63141557",     // 翻訳歌
  "Q59847891",     // digital promotional single
  "Q106042566",    // シングル・アルバム (K-pop の形式: 主曲 + b-side)
  "Q106077699",    // video single (映像版だが本体はシングル)
  "Q207628",       // 楽曲 (musical composition の派生)
  "Q4132319",      // 楽曲のサブクラス
  "Q1259759",      // cover song
]);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes("--dry-run"),
    // 評価が付いた非楽曲も強制的に削除する (既定はユーザー評価保護のためスキップ)
    force: args.includes("--force"),
  };
}

async function main() {
  const { dryRun, force } = parseArgs();
  const supabase = createAdminClient();

  // 全 wikidata_qid を取得 (id も含めて削除に使う)。
  const songs: Array<{ id: string; title: string; artist: string; qid: string }> = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, wikidata_qid")
      .not("wikidata_qid", "is", null)
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as Array<{
      id: string;
      title: string;
      artist: string;
      wikidata_qid: string;
    }>;
    for (const r of rows) {
      songs.push({ id: r.id, title: r.title, artist: r.artist, qid: r.wikidata_qid });
    }
    if (rows.length < 1000) break;
    offset += 1000;
  }
  console.log(`total wikidata_qid songs: ${songs.length}, dryRun=${dryRun}`);

  // P31 を batch でフェッチ。
  const typeByQ = new Map<string, Set<string>>();
  for (let i = 0; i < songs.length; i += BATCH) {
    const batch = songs.slice(i, i + BATCH);
    const values = batch.map((s) => `wd:${s.qid}`).join(" ");
    const sparql = `
      SELECT ?item ?p31 WHERE {
        VALUES ?item { ${values} }
        ?item wdt:P31 ?p31.
      }
    `;
    const url = `${SPARQL}?query=${encodeURIComponent(sparql)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) {
      console.error(`  batch ${i}: HTTP ${res.status}, retry after 5s`);
      await sleep(5000);
      i -= BATCH; // retry
      continue;
    }
    const json = (await res.json()) as {
      results: { bindings: Array<{ item: { value: string }; p31: { value: string } }> };
    };
    for (const b of json.results.bindings) {
      const q = b.item.value.split("/").pop()!;
      const t = b.p31.value.split("/").pop()!;
      const set = typeByQ.get(q) ?? new Set();
      set.add(t);
      typeByQ.set(q, set);
    }

    if (Math.floor(i / BATCH) % 10 === 0) {
      console.log(`  fetched ${Math.min(i + BATCH, songs.length)}/${songs.length}`);
    }
    await sleep(SLEEP_MS);
  }

  // 判定: whitelist 該当が無い song を削除候補に。
  const toDelete: typeof songs = [];
  const noP31: typeof songs = [];
  for (const s of songs) {
    const types = typeByQ.get(s.qid);
    if (!types || types.size === 0) {
      noP31.push(s);
      continue;
    }
    const hasSongType = Array.from(types).some((t) => SONG_WHITELIST.has(t));
    if (!hasSongType) toDelete.push(s);
  }

  console.log(`\nto delete: ${toDelete.length}`);
  console.log(`no-P31 (kept conservatively): ${noP31.length}`);
  console.log("\nsample deletion candidates:");
  for (const s of toDelete.slice(0, 20)) {
    const types = Array.from(typeByQ.get(s.qid) ?? []);
    console.log(`  ${s.qid}\t${s.artist} - ${s.title}\t[${types.join(",")}]`);
  }

  // 安全策: 評価が付いた候補を特定する。survivor が無いので付け替えできず、
  // 削除すると cascade でユーザー評価が消える。既定では除外、--force で削除。
  const ratedIds = new Set<string>();
  {
    const candidateIds = toDelete.map((s) => s.id);
    for (let i = 0; i < candidateIds.length; i += 200) {
      const ids = candidateIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("evaluations")
        .select("song_id")
        .in("song_id", ids);
      if (error) throw error;
      for (const r of data ?? []) ratedIds.add(r.song_id);
    }
  }
  if (ratedIds.size > 0) {
    const totalEvals = await countEvaluationsForSongs(
      supabase,
      Array.from(ratedIds),
    );
    if (force) {
      console.warn(
        `\n[--force] 評価付き非楽曲 ${ratedIds.size} 件 (評価 ${totalEvals} 件) も削除します`,
      );
    } else {
      console.warn(
        `\n評価付きの候補 ${ratedIds.size} 件 (評価 ${totalEvals} 件) は削除をスキップします (--force で強制削除)`,
      );
    }
  }

  const finalDelete = force
    ? toDelete
    : toDelete.filter((s) => !ratedIds.has(s.id));

  if (dryRun) {
    console.log(
      `\nDRY-RUN: no deletes performed. (would delete ${finalDelete.length}, skip-rated ${toDelete.length - finalDelete.length})`,
    );
    return;
  }

  // DELETE は ID リストで in() するが、PostgREST URL 長制限を避けるため batch。
  const DELETE_BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < finalDelete.length; i += DELETE_BATCH) {
    const ids = finalDelete.slice(i, i + DELETE_BATCH).map((s) => s.id);
    const { error } = await supabase.from("songs").delete().in("id", ids);
    if (error) {
      console.error(`  delete batch ${i}: ${error.message}`);
      continue;
    }
    deleted += ids.length;
    if (Math.floor(i / DELETE_BATCH) % 5 === 0) {
      console.log(`  deleted ${deleted}/${finalDelete.length}`);
    }
  }
  console.log(
    `\ndone. deleted=${deleted}, skipped(rated)=${toDelete.length - finalDelete.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Wikidata 由来楽曲のうち、ASCII-only タイトルになっているものを
 * 多言語ラベル (ja/zh/ko 等) から CJK 版で復元する。重複は削除。
 *
 * 背景: 一部の Wikidata エンティティは ja ラベルが未設定で en (ローマ字) のみ
 * 設定されている (例: King Gnu 「逆夢」 = Q116213860 → en="Sakayume",
 * zh/zh-tw="逆夢", ja=未設定)。expand-via-wikipedia は en にフォールバック
 * して "Sakayume" を保存してしまった。
 *
 * 戦略:
 *  - ASCII-only タイトル & CJK アーティスト名 の WD 曲を suspicion 対象に
 *  - SPARQL で 各 entity の rdfs:label を全言語取得
 *  - "ja" > "zh-tw" > "zh" > "zh-cn" > "ko" の優先で **CJK 文字を含むラベル**を採用
 *  - 採用ラベルが取れたら title を UPDATE
 *  - UPDATE 後、同 artist の既存曲と normalize 衝突するなら DELETE
 *  - 採用ラベルが取れなかった (= 元々英語タイトル) なら無視
 *
 * 使い方:
 *   pnpm cleanup:wikidata-romanized --dry-run
 *   pnpm cleanup:wikidata-romanized
 */
import { createAdminClient } from "../src/lib/supabase/admin";

const SPARQL = "https://query.wikidata.org/sparql";
const UA =
  "karaoke-recommender-research/0.1 (hiroto.lalapalooza.ikeda@gmail.com)";

const BATCH = 50;
const SLEEP_MS = 800;

const LANG_PRIORITY = ["ja", "zh-tw", "zh", "zh-cn", "ko"];

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  wikidata_qid: string;
}

function parseArgs() {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

function isAsciiOnly(s: string): boolean {
  // ASCII printable + space のみ
  return /^[\x00-\x7F]+$/.test(s);
}

function hasCJK(s: string): boolean {
  return /[぀-ヿ㐀-鿿가-힯]/.test(s);
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

async function loadAllSongs(supabase: ReturnType<typeof createAdminClient>) {
  const songs: SongRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, artist_id, wikidata_qid")
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as SongRow[];
    songs.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return songs;
}

async function fetchLabelsBatch(
  qids: string[],
): Promise<Map<string, Map<string, string>>> {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  const sparql = `
    SELECT ?item ?label ?lang WHERE {
      VALUES ?item { ${values} }
      ?item rdfs:label ?label.
      BIND(LANG(?label) AS ?lang)
      FILTER(?lang IN ("ja", "zh", "zh-tw", "zh-cn", "ko"))
    }
  `;
  const url = `${SPARQL}?query=${encodeURIComponent(sparql)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
  });
  if (!res.ok) throw new Error(`sparql ${res.status}`);
  const json = (await res.json()) as {
    results: {
      bindings: Array<{
        item: { value: string };
        label: { value: string };
        lang: { value: string };
      }>;
    };
  };
  const out = new Map<string, Map<string, string>>();
  for (const b of json.results.bindings) {
    const q = b.item.value.split("/").pop()!;
    const lang = b.lang.value;
    const label = b.label.value;
    let langMap = out.get(q);
    if (!langMap) {
      langMap = new Map();
      out.set(q, langMap);
    }
    if (!langMap.has(lang)) langMap.set(lang, label);
  }
  return out;
}

function pickCJKLabel(labels: Map<string, string>): string | null {
  for (const lang of LANG_PRIORITY) {
    const v = labels.get(lang);
    if (v && hasCJK(v)) return v;
  }
  return null;
}

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createAdminClient();

  const all = await loadAllSongs(supabase);
  console.log(`total songs: ${all.length}, dryRun=${dryRun}`);

  // 既存 (artist_id, norm_title) インデックス
  const idx = new Map<string, SongRow[]>();
  for (const s of all) {
    if (!s.artist_id) continue;
    const k = `${s.artist_id}|${normalizeTitle(s.title)}`;
    const list = idx.get(k) ?? [];
    list.push(s);
    idx.set(k, list);
  }

  // suspicion: WD 曲 + ASCII-only title。JA アーティスト判定は外す
  // (King Gnu / RADWIMPS のように英字バンド名の JA アーティストを取りこぼす)。
  const suspects = all.filter(
    (s) => s.wikidata_qid && isAsciiOnly(s.title),
  );
  console.log(`suspects (WD + ascii title): ${suspects.length}`);

  // SPARQL で multi-lang labels を batch 取得
  const labelByQid = new Map<string, Map<string, string>>();
  for (let i = 0; i < suspects.length; i += BATCH) {
    const batch = suspects.slice(i, i + BATCH).map((s) => s.wikidata_qid);
    try {
      const m = await fetchLabelsBatch(batch);
      for (const [q, langs] of m) labelByQid.set(q, langs);
    } catch (e) {
      console.error(`  batch ${i} error:`, (e as Error).message);
      await sleep(5000);
    }
    if (Math.floor(i / BATCH) % 10 === 0) {
      console.log(`  fetched ${Math.min(i + BATCH, suspects.length)}/${suspects.length}`);
    }
    await sleep(SLEEP_MS);
  }

  const updates: Array<{ id: string; from: string; to: string }> = [];
  const deletes: Array<{ id: string; reason: string; title: string }> = [];
  let noCjkLabel = 0;

  /** suffix 剥がし + 整形。CJK を含まなければ null。 */
  function cleanCJK(raw: string | undefined): string | null {
    if (!raw) return null;
    const cleaned = raw
      .replace(/\s*\([^()]*の曲\)\s*$/, "")
      .replace(/\s*\([^()]*のシングル\)\s*$/, "")
      .replace(/\s*\([^()]*の楽曲\)\s*$/, "")
      .replace(/\s*\((?:楽曲|曲)\)\s*$/, "")
      .replace(/\s*\((?:song|track)\)\s*$/i, "")
      .trim();
    if (!cleaned || !hasCJK(cleaned)) return null;
    return cleaned;
  }

  for (const s of suspects) {
    const langs = labelByQid.get(s.wikidata_qid);
    if (!langs) {
      noCjkLabel++;
      continue;
    }

    // 戦略:
    //  1) ja ラベルがあれば信頼して rename。既存と衝突するなら DELETE。
    //  2) ja が無く zh/zh-tw だけある場合は、それが既存 DB の単曲と一致するなら
    //     DELETE (Sakayume → 逆夢 ケース)。それ以外は触らない (中国語訳の可能性)。
    const jaCleaned = cleanCJK(langs.get("ja"));
    if (jaCleaned && jaCleaned !== s.title) {
      if (s.artist_id) {
        const k = `${s.artist_id}|${normalizeTitle(jaCleaned)}`;
        const collide = (idx.get(k) ?? []).filter((x) => x.id !== s.id);
        if (collide.length > 0) {
          deletes.push({
            id: s.id,
            reason: `ja label "${jaCleaned}" dup of "${collide[0].title}"`,
            title: s.title,
          });
        } else {
          updates.push({ id: s.id, from: s.title, to: jaCleaned });
        }
      } else {
        updates.push({ id: s.id, from: s.title, to: jaCleaned });
      }
      continue;
    }

    // ja 無し。zh / zh-tw に頼る場合は rename しない、衝突削除のみ。
    const zhCleaned =
      cleanCJK(langs.get("zh-tw")) ??
      cleanCJK(langs.get("zh")) ??
      cleanCJK(langs.get("zh-cn"));
    if (zhCleaned && s.artist_id) {
      const k = `${s.artist_id}|${normalizeTitle(zhCleaned)}`;
      const collide = (idx.get(k) ?? []).filter((x) => x.id !== s.id);
      if (collide.length > 0) {
        deletes.push({
          id: s.id,
          reason: `zh label "${zhCleaned}" dup of "${collide[0].title}"`,
          title: s.title,
        });
        continue;
      }
    }
    noCjkLabel++;
  }

  console.log(`\n=== summary ===`);
  console.log(`  rename to CJK: ${updates.length}`);
  console.log(`  delete (dup of orig after CJK substitution): ${deletes.length}`);
  console.log(`  no CJK label found (kept as-is): ${noCjkLabel}`);

  console.log("\n=== sample renames ===");
  for (const u of updates.slice(0, 15))
    console.log(`  "${u.from}" → "${u.to}"`);
  console.log("\n=== sample deletes ===");
  for (const d of deletes.slice(0, 15))
    console.log(`  DELETE "${d.title}" (${d.reason})`);

  if (dryRun) {
    console.log("\nDRY-RUN: no writes performed.");
    return;
  }

  let updated = 0;
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const { error } = await supabase
      .from("songs")
      .update({ title: u.to })
      .eq("id", u.id);
    if (error) {
      console.error(`  update ${u.id}: ${error.message}`);
      continue;
    }
    updated++;
    if ((i + 1) % 100 === 0) console.log(`  updated ${i + 1}/${updates.length}`);
  }

  let deleted = 0;
  const ids = deletes.map((d) => d.id);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await supabase.from("songs").delete().in("id", batch);
    if (error) {
      console.error(`  delete batch ${i}: ${error.message}`);
      continue;
    }
    deleted += batch.length;
  }

  console.log(`\ndone. updated=${updated}, deleted=${deleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

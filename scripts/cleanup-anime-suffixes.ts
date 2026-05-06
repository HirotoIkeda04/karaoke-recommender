/**
 * 曲タイトル末尾の 『アニメ名』形式のタイアップ表記を除去する。
 *
 * DAM ランキングの季節アニメページから取得したタイトルには
 * "聖者の行進 『平穏世代の韋駄天達』" のようなタイアップ suffix が混入する。
 * 本来の曲名は "聖者の行進" だけ。
 *
 * 戦略 (cleanup-wikidata-titles.ts と同じ流儀):
 *   1. title が `[空白]?『...』[空白]?` で終わるレコードを抽出
 *   2. 末尾の suffix を剥がした cleaned title を作る
 *   3. cleaned title が空 → skip
 *   4. (artist_id, normalize(cleaned)) が既存と衝突 → DELETE
 *   5. 衝突しない → UPDATE title
 *
 * 「...」 (鉤括弧) は曲名に組み込まれている例 (「居酒屋『敦賀』」の "敦賀") が
 * 多いため対象外。『...』 (二重鉤括弧) のみを対象とする。
 *
 * 使い方:
 *   pnpm cleanup:anime-suffixes --dry-run
 *   pnpm cleanup:anime-suffixes
 */
import { createAdminClient } from "../src/lib/supabase/admin";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
}

function parseArgs() {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

function normalizeTitle(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/『[^』]*』/g, "")
    .replace(/「[^」]*」/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

const SUFFIX_RE = /[ 　]*『[^』]*』[ 　]*$/;

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createAdminClient();

  // 1. 全曲取得
  const all: SongRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist, artist_id")
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as SongRow[];
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  console.log(`total songs: ${all.length}`);

  // 2. (artist_id, normalize(title)) インデックス
  const idx = new Map<string, SongRow[]>();
  for (const s of all) {
    if (!s.artist_id) continue;
    const k = `${s.artist_id}|${normalizeTitle(s.title)}`;
    const list = idx.get(k) ?? [];
    list.push(s);
    idx.set(k, list);
  }

  // 3. suffix を持つ曲の処理候補を作る
  const updates: Array<{ id: string; from: string; to: string }> = [];
  const deletes: Array<{ id: string; reason: string; title: string }> = [];

  for (const s of all) {
    if (!SUFFIX_RE.test(s.title)) continue;
    const cleaned = s.title.replace(SUFFIX_RE, "").trim();
    if (!cleaned) continue;
    if (cleaned === s.title) continue;
    if (!s.artist_id) {
      updates.push({ id: s.id, from: s.title, to: cleaned });
      continue;
    }
    // cleaned title での既存衝突チェック
    const k = `${s.artist_id}|${normalizeTitle(cleaned)}`;
    const others = (idx.get(k) ?? []).filter((x) => x.id !== s.id);
    if (others.length > 0) {
      deletes.push({
        id: s.id,
        reason: `dup of "${others[0].title}"`,
        title: s.title,
      });
    } else {
      updates.push({ id: s.id, from: s.title, to: cleaned });
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  rename: ${updates.length}`);
  console.log(`  delete (collide with existing clean title): ${deletes.length}`);

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

  // 4. UPDATE
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

  // 5. DELETE
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

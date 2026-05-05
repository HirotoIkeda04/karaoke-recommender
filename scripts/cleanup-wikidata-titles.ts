/**
 * Wikidata 由来楽曲のタイトル品質を 2 段階でクリーンアップする。
 *
 * Phase A: disambiguation suffix の正規化
 *   "もう一度だけ (Da-iCeの曲)" → "もう一度だけ"
 *   "○○ (楽曲)" / "○○ (曲)" / "○○ (song)" / "○○ (○○のシングル)" 等を削除。
 *   - 正規化後タイトルが同 artist の既存曲と被るなら **DELETE** (このレコード)
 *   - 被らないなら タイトルを **UPDATE**
 *
 * Phase B: 両A面 / 複数トラックリリースの重複検出
 *   "一途／逆夢" / "三文小説/千両役者" のようなスラッシュ区切りで、
 *   分割した各タイトルが同 artist で既に独立して存在する場合は **DELETE**。
 *
 * 使い方:
 *   pnpm cleanup:wikidata-titles --dry-run   # 候補一覧のみ
 *   pnpm cleanup:wikidata-titles             # 実行
 */
import { createAdminClient } from "../src/lib/supabase/admin";

interface SongRow {
  id: string;
  title: string;
  artist_id: string | null;
  wikidata_qid: string;
}

function parseArgs() {
  return { dryRun: process.argv.slice(2).includes("--dry-run") };
}

/** 比較用の正規化 (既存スクリプトと同じ流儀)。*/
function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[[【][^\]】]*[\]】]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

/** タイトル末尾の disambiguation suffix を 1 段だけ剥がす。
 *  - "(○○の曲)" / "(○○のシングル)" / "(○○の楽曲)"
 *  - "(楽曲)" / "(曲)" / "(song)" / "(track)"
 *  剥がせなかった場合は null。
 */
function stripDisambig(title: string): string | null {
  const patterns: RegExp[] = [
    /\s*\([^()]*の曲\)\s*$/,
    /\s*\([^()]*のシングル\)\s*$/,
    /\s*\([^()]*の楽曲\)\s*$/,
    /\s*\((?:楽曲|曲)\)\s*$/,
    /\s*\((?:song|track)\)\s*$/i,
  ];
  for (const re of patterns) {
    if (re.test(title)) {
      return title.replace(re, "").trim();
    }
  }
  return null;
}

/** "/" / "／" で分割。複数のセパレータが混在しても分解する。 */
function splitMultiTitle(title: string): string[] | null {
  if (!/[／/]/.test(title)) return null;
  const parts = title.split(/[／/]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts;
}

async function loadAllSongs(supabase: ReturnType<typeof createAdminClient>) {
  const songs: SongRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select("id, title, artist_id, wikidata_qid")
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as SongRow[];
    songs.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return songs;
}

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createAdminClient();

  const all = await loadAllSongs(supabase);
  console.log(`total songs in DB: ${all.length}, dryRun=${dryRun}`);

  // (artist_id, normalized_title) -> SongRow[] のインデックス。
  // 正規化後 (suffix 剥がし後 / slash split 後) の重複判定に使う。
  const idxByArtist = new Map<string, Map<string, SongRow[]>>();
  for (const s of all) {
    if (!s.artist_id) continue;
    const norm = normalizeTitle(s.title);
    let m = idxByArtist.get(s.artist_id);
    if (!m) {
      m = new Map();
      idxByArtist.set(s.artist_id, m);
    }
    const list = m.get(norm) ?? [];
    list.push(s);
    m.set(norm, list);
  }

  const wdSongs = all.filter((s) => s.wikidata_qid);

  // ---------- Phase A: disambiguation suffix ----------
  const phaseAUpdates: Array<{ id: string; from: string; to: string }> = [];
  const phaseADeletes: Array<{ id: string; reason: string; title: string }> = [];

  for (const s of wdSongs) {
    if (!s.artist_id) continue;
    const stripped = stripDisambig(s.title);
    if (!stripped || stripped === s.title) continue;
    if (stripped === "") {
      phaseADeletes.push({ id: s.id, reason: "stripped to empty", title: s.title });
      continue;
    }
    const newNorm = normalizeTitle(stripped);
    const existingList = idxByArtist.get(s.artist_id)?.get(newNorm) ?? [];
    // 自分以外で同 artist + 同正規化タイトルが居れば → 重複なので DELETE
    const others = existingList.filter((x) => x.id !== s.id);
    if (others.length > 0) {
      phaseADeletes.push({
        id: s.id,
        reason: `dup of ${others[0].title} (${others[0].id})`,
        title: s.title,
      });
    } else {
      phaseAUpdates.push({ id: s.id, from: s.title, to: stripped });
    }
  }

  // ---------- Phase B: slash multi-title duplicates ----------
  const phaseBDeletes: Array<{ id: string; title: string; parts: string[] }> = [];
  for (const s of wdSongs) {
    if (!s.artist_id) continue;
    const parts = splitMultiTitle(s.title);
    if (!parts) continue;
    const idx = idxByArtist.get(s.artist_id);
    if (!idx) continue;
    const allPartsExist = parts.every((p) => {
      const norm = normalizeTitle(p);
      const list = idx.get(norm) ?? [];
      // 自分以外の row が同 artist で居るかチェック
      return list.some((x) => x.id !== s.id);
    });
    if (allPartsExist) {
      phaseBDeletes.push({ id: s.id, title: s.title, parts });
    }
  }

  // 重複削除候補を統合
  const deleteIds = new Set<string>();
  for (const d of phaseADeletes) deleteIds.add(d.id);
  for (const d of phaseBDeletes) deleteIds.add(d.id);
  // Phase A の UPDATE のうち Phase B で削除予定のものは update を抑止
  const updates = phaseAUpdates.filter((u) => !deleteIds.has(u.id));

  // ---------- Report ----------
  console.log(`\n=== Phase A: disambiguation suffix ===`);
  console.log(`  rename candidates: ${updates.length}`);
  console.log(`  delete (collides with existing): ${phaseADeletes.length}`);
  console.log("  sample renames:");
  for (const u of updates.slice(0, 10)) console.log(`    "${u.from}" → "${u.to}"`);
  console.log("  sample collisions:");
  for (const d of phaseADeletes.slice(0, 10))
    console.log(`    DELETE "${d.title}" (${d.reason})`);

  console.log(`\n=== Phase B: slash duplicates ===`);
  console.log(`  delete: ${phaseBDeletes.length}`);
  console.log("  samples:");
  for (const d of phaseBDeletes.slice(0, 10))
    console.log(`    DELETE "${d.title}" → parts ${JSON.stringify(d.parts)}`);

  console.log(
    `\nTotal updates: ${updates.length}, total deletes: ${deleteIds.size}`,
  );

  if (dryRun) {
    console.log("\nDRY-RUN: no writes performed.");
    return;
  }

  // ---------- Apply ----------
  // UPDATE は 1 件ずつ (PostgREST の bulk update は WHERE が単純条件のみ)
  let updatedCount = 0;
  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    const { error } = await supabase
      .from("songs")
      .update({ title: u.to })
      .eq("id", u.id);
    if (error) {
      console.error(`  update error ${u.id}: ${error.message}`);
      continue;
    }
    updatedCount++;
    if ((i + 1) % 100 === 0) console.log(`  updated ${i + 1}/${updates.length}`);
  }

  // DELETE は batch で
  let deletedCount = 0;
  const ids = Array.from(deleteIds);
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { error } = await supabase.from("songs").delete().in("id", batch);
    if (error) {
      console.error(`  delete batch ${i}: ${error.message}`);
      continue;
    }
    deletedCount += batch.length;
    if ((i / 100) % 5 === 0) console.log(`  deleted ${deletedCount}/${ids.length}`);
  }

  console.log(`\ndone. updated=${updatedCount}, deleted=${deletedCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

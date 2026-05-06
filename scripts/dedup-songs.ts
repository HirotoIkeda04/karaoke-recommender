/**
 * (artist_id, normalize(NFKC) title) で重複している曲を整理する。
 *
 * 背景: seed-from-{dam,joysound}-ranking で全角・半角の表記揺れを正規化せずに
 * dedup していたため、同 artist 内に表記違いの重複が混入した
 * (例: "=LOVE | とくべチュ、して" と "＝LOVE | とくべチュ、して")。
 *
 * 戦略:
 *  1. 全曲取得 → (artist_id, NFKC 正規化 title) でグルーピング
 *  2. 各グループに 2 件以上あれば 1 件だけ残す。残す優先順:
 *       (a) evaluations / song_logs / user_known_songs から参照されている
 *       (b) spotify_track_id あり
 *       (c) image_url_medium あり
 *       (d) created_at が古い (=元から居た方)
 *  3. 残し以外を DELETE (CASCADE で評価も消えるが、(a) で評価ある側を必ず残す)
 *
 * 使い方:
 *   pnpm dedup:songs --dry-run
 *   pnpm dedup:songs
 */
import { createAdminClient } from "../src/lib/supabase/admin";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  spotify_track_id: string | null;
  image_url_medium: string | null;
  created_at: string;
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

async function main() {
  const { dryRun } = parseArgs();
  const supabase = createAdminClient();

  // 1. 全曲取得 (ページング)
  const all: SongRow[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("songs")
      .select(
        "id, title, artist, artist_id, spotify_track_id, image_url_medium, created_at",
      )
      .range(offset, offset + 999);
    if (error) throw error;
    const rows = data as SongRow[];
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  console.log(`total songs: ${all.length}`);

  // 2. グルーピング
  const groups = new Map<string, SongRow[]>();
  for (const s of all) {
    if (!s.artist_id) continue;
    const k = `${s.artist_id}|${normalizeTitle(s.title)}`;
    const list = groups.get(k) ?? [];
    list.push(s);
    groups.set(k, list);
  }
  const dupGroups = Array.from(groups.values()).filter((g) => g.length >= 2);
  console.log(`duplicate groups: ${dupGroups.length}`);

  if (dupGroups.length === 0) {
    console.log("no duplicates. nothing to do.");
    return;
  }

  // 3. 参照件数を取得 (evaluations / song_logs / user_known_songs)
  const allDupIds = dupGroups.flatMap((g) => g.map((s) => s.id));
  const refCount = new Map<string, number>();
  for (const id of allDupIds) refCount.set(id, 0);

  for (const tbl of ["evaluations", "song_logs", "user_known_songs"] as const) {
    for (let i = 0; i < allDupIds.length; i += 200) {
      const ids = allDupIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from(tbl)
        .select("song_id")
        .in("song_id", ids);
      if (error) {
        console.error(`  ${tbl} query: ${error.message}`);
        continue;
      }
      for (const r of data ?? []) {
        refCount.set(r.song_id, (refCount.get(r.song_id) ?? 0) + 1);
      }
    }
  }

  // 4. 各グループで「残し」を決定
  function score(s: SongRow): number {
    return (
      (refCount.get(s.id) ?? 0) * 1_000_000 +
      (s.spotify_track_id ? 10_000 : 0) +
      (s.image_url_medium ? 100 : 0) +
      // created_at 古いほど高得点 (= -ms / 1e10 程度)
      -new Date(s.created_at).getTime() / 1e10
    );
  }

  const decisions: Array<{
    keep: SongRow;
    drop: SongRow[];
  }> = [];
  for (const g of dupGroups) {
    const ranked = [...g].sort((a, b) => score(b) - score(a));
    decisions.push({ keep: ranked[0], drop: ranked.slice(1) });
  }

  console.log("\n=== decisions ===");
  for (const d of decisions) {
    console.log(`  KEEP "${d.keep.title}" | "${d.keep.artist}"`);
    for (const s of d.drop) {
      const refs = refCount.get(s.id) ?? 0;
      console.log(
        `    DROP "${s.title}" | "${s.artist}" (refs=${refs}, sp=${
          s.spotify_track_id ? "Y" : "N"
        }, img=${s.image_url_medium ? "Y" : "N"})`,
      );
    }
  }

  const dropIds = decisions.flatMap((d) => d.drop.map((s) => s.id));
  console.log(`\ntotal to delete: ${dropIds.length}`);
  const totalRefsLost = decisions
    .flatMap((d) => d.drop)
    .reduce((a, s) => a + (refCount.get(s.id) ?? 0), 0);
  console.log(`refs lost (cascade delete): ${totalRefsLost}`);

  if (dryRun) {
    console.log("\nDRY-RUN: no writes performed.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < dropIds.length; i += 50) {
    const batch = dropIds.slice(i, i + 50);
    const { error } = await supabase.from("songs").delete().in("id", batch);
    if (error) {
      console.error(`  delete batch ${i}: ${error.message}`);
      continue;
    }
    deleted += batch.length;
  }
  console.log(`\ndone. deleted=${deleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

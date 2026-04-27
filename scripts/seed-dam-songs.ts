/**
 * scraper/output/dam_songs.json を読み込み、Supabase の songs テーブルへ
 * (title, artist) マージ方式で投入する。
 *
 * 実行: pnpm seed:dam
 *
 * マージ仕様:
 *  1. 各 DAM 曲について (title, artist) で既存行を検索
 *  2. ヒットした行を以下の優先度で 1 つ選ぶ
 *     - karaoto 由来 (= spotify_track_id か range_high_midi が入っている) を最優先
 *     - 次に DAM 由来 (= dam_request_no が入っている)
 *  3. 選ばれた行を UPDATE してマージ:
 *     - dam_request_no: 常に JSON の値で上書き
 *     - range_*: 既存が NULL のときだけ karaoto 経由値で埋める
 *     - image_url_*: iTunes 画像があれば優先 (1200x1200 > Spotify 640)
 *     - source_urls: 既存 ∪ DAM URL ∪ iTunes URL
 *  4. 同一 (title, artist) の他の DAM-only 重複行は DELETE
 *  5. ヒット行が無ければ新規 INSERT
 *
 * これにより: 過去 seed 時の重複 (karaoto 行と DAM 行が両方ある状態) を解消し、
 * 今後も run-to-run で重複しない冪等な挙動になる。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongRow = Database["public"]["Tables"]["songs"]["Row"];
type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];
type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

interface DamSeedRow {
  title: string;
  artist: string;
  dam_request_no: string;
  source_pages: string[];
  release_year: number | null;
  range_low_midi: number | null;
  range_high_midi: number | null;
  falsetto_max_midi: number | null;
  karaoto_source_url: string | null;
  image_url_small: string | null;
  image_url_medium: string | null;
  image_url_large: string | null;
  itunes_track_view_url: string | null;
  itunes_similarity: number | null;
}

interface SeedFile {
  songs: DamSeedRow[];
  metadata: { scraped_at: string; total_count: number; sources: string[] };
}

function buildSourceUrls(s: DamSeedRow, existing: string[] | null): string[] {
  const urls = new Set<string>(existing ?? []);
  urls.add(
    `https://www.clubdam.com/karaokesearch/songleaf.html?requestNo=${s.dam_request_no}`,
  );
  if (s.itunes_track_view_url) urls.add(s.itunes_track_view_url);
  if (s.karaoto_source_url) urls.add(s.karaoto_source_url);
  return Array.from(urls);
}

function pickPrimary(matches: SongRow[]): SongRow | null {
  if (matches.length === 0) return null;
  // 優先度: karaoto 由来 (spotify_track_id か range_high_midi あり) → DAM 由来 → その他
  const isKaraotoLike = (r: SongRow) =>
    r.spotify_track_id !== null || r.range_high_midi !== null;
  const karaotoRow = matches.find(isKaraotoLike);
  if (karaotoRow) return karaotoRow;
  return matches[0];
}

function buildUpdate(
  s: DamSeedRow,
  existing: SongRow,
): SongUpdate {
  const update: SongUpdate = {
    dam_request_no: s.dam_request_no,
    source_urls: buildSourceUrls(s, existing.source_urls),
  };

  // range は既存が NULL のときだけ karaoto 経由値で埋める
  if (existing.range_low_midi === null && s.range_low_midi !== null) {
    update.range_low_midi = s.range_low_midi;
  }
  if (existing.range_high_midi === null && s.range_high_midi !== null) {
    update.range_high_midi = s.range_high_midi;
  }
  if (existing.falsetto_max_midi === null && s.falsetto_max_midi !== null) {
    update.falsetto_max_midi = s.falsetto_max_midi;
  }

  // release_year も同様 (既存優先、無ければ iTunes 経由値で埋める)
  if (existing.release_year === null && s.release_year !== null) {
    update.release_year = s.release_year;
  }

  // 画像: iTunes の 1200x1200 は Spotify の 640x640 より高解像 → iTunes があれば常に置き換え
  if (s.image_url_large) update.image_url_large = s.image_url_large;
  if (s.image_url_medium) update.image_url_medium = s.image_url_medium;
  if (s.image_url_small) update.image_url_small = s.image_url_small;

  return update;
}

function buildInsert(s: DamSeedRow): SongInsert {
  return {
    title: s.title,
    artist: s.artist,
    release_year: s.release_year,
    range_low_midi: s.range_low_midi,
    range_high_midi: s.range_high_midi,
    falsetto_max_midi: s.falsetto_max_midi,
    spotify_track_id: null,
    image_url_large: s.image_url_large,
    image_url_medium: s.image_url_medium,
    image_url_small: s.image_url_small,
    source_urls: buildSourceUrls(s, null),
    is_popular: true,
    dam_request_no: s.dam_request_no,
    match_status: "pending",
  };
}

interface MergeStats {
  inserted: number;
  updated: number;
  duplicatesDeleted: number;
  rangeFilled: number;
  errors: number;
}

async function main() {
  const seedPath = resolve(process.cwd(), "scraper/output/dam_songs.json");
  const seed: SeedFile = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(
    `loaded ${seed.songs.length} DAM songs (scraped_at=${seed.metadata.scraped_at})`,
  );

  const itunesHits = seed.songs.filter((s) => s.image_url_large).length;
  const karaotoHits = seed.songs.filter((s) => s.range_high_midi !== null).length;
  console.log(
    `enrichment: iTunes ${itunesHits}/${seed.songs.length} ` +
    `(${((itunesHits / seed.songs.length) * 100).toFixed(1)}%), ` +
    `karaoto range ${karaotoHits}/${seed.songs.length} ` +
    `(${((karaotoHits / seed.songs.length) * 100).toFixed(1)}%)`,
  );

  const supabase = createAdminClient();
  const stats: MergeStats = {
    inserted: 0,
    updated: 0,
    duplicatesDeleted: 0,
    rangeFilled: 0,
    errors: 0,
  };

  for (const [i, song] of seed.songs.entries()) {
    try {
      const { data: matches, error: selErr } = await supabase
        .from("songs")
        .select("*")
        .eq("title", song.title)
        .eq("artist", song.artist);

      if (selErr) {
        console.error(`[${i + 1}] select failed for ${song.title}:`, selErr);
        stats.errors++;
        continue;
      }

      const target = pickPrimary(matches ?? []);

      if (target === null) {
        // 新規 INSERT
        const { error: insErr } = await supabase
          .from("songs")
          .insert(buildInsert(song));
        if (insErr) {
          console.error(`[${i + 1}] insert failed for ${song.title}:`, insErr);
          stats.errors++;
          continue;
        }
        stats.inserted++;
      } else {
        // 重複行 (target 以外) を先に削除 (UNIQUE 制約衝突回避)
        const dupIds = (matches ?? [])
          .filter((r) => r.id !== target.id)
          .map((r) => r.id);
        if (dupIds.length > 0) {
          const { error: delErr } = await supabase
            .from("songs")
            .delete()
            .in("id", dupIds);
          if (delErr) {
            console.error(
              `[${i + 1}] dup delete failed for ${song.title}:`,
              delErr,
            );
            stats.errors++;
            continue;
          }
          stats.duplicatesDeleted += dupIds.length;
        }

        // target に UPDATE (マージ)
        const update = buildUpdate(song, target);
        const willFillRange =
          target.range_high_midi === null && song.range_high_midi !== null;

        const { error: updErr } = await supabase
          .from("songs")
          .update(update)
          .eq("id", target.id);
        if (updErr) {
          console.error(`[${i + 1}] update failed for ${song.title}:`, updErr);
          stats.errors++;
          continue;
        }
        stats.updated++;
        if (willFillRange) stats.rangeFilled++;
      }

      if ((i + 1) % 50 === 0) {
        console.log(
          `  progress ${i + 1}/${seed.songs.length}: inserted=${stats.inserted} ` +
          `updated=${stats.updated} dups_deleted=${stats.duplicatesDeleted} ` +
          `range_filled=${stats.rangeFilled} errors=${stats.errors}`,
        );
      }
    } catch (e) {
      console.error(`[${i + 1}] unexpected error for ${song.title}:`, e);
      stats.errors++;
    }
  }

  // ----- Orphan cleanup -----
  // 過去 seed:dam で投入したが、現 JSON には居ない曲 (= ジャンル除外で消えた等) を整理:
  //   - karaoto 由来データ (spotify_track_id か range_high_midi) を持つ行: dam_request_no
  //     と source_urls から DAM 関連のみ削除し、行自体は残す
  //   - 純 DAM 行 (上記が無い): 行ごと DELETE
  const currentDamIds = new Set(seed.songs.map((s) => s.dam_request_no));
  const { data: allDamRows, error: orphErr } = await supabase
    .from("songs")
    .select(
      "id, dam_request_no, spotify_track_id, range_high_midi, source_urls, title, artist",
    )
    .not("dam_request_no", "is", null);
  if (orphErr) {
    console.error("orphan scan failed:", orphErr);
    process.exit(1);
  }

  let orphanDeleted = 0;
  let orphanCleared = 0;
  for (const row of allDamRows ?? []) {
    if (!row.dam_request_no || currentDamIds.has(row.dam_request_no)) continue;

    const isMergedKaraoto =
      row.spotify_track_id !== null || row.range_high_midi !== null;
    const damUrl =
      `https://www.clubdam.com/karaokesearch/songleaf.html?requestNo=${row.dam_request_no}`;

    if (isMergedKaraoto) {
      const cleanedUrls = (row.source_urls ?? []).filter((u) => u !== damUrl);
      const { error: updErr } = await supabase
        .from("songs")
        .update({ dam_request_no: null, source_urls: cleanedUrls })
        .eq("id", row.id);
      if (updErr) {
        console.error(
          `orphan clear failed for ${row.title} (${row.dam_request_no}):`,
          updErr,
        );
        stats.errors++;
        continue;
      }
      orphanCleared++;
    } else {
      const { error: delErr } = await supabase
        .from("songs")
        .delete()
        .eq("id", row.id);
      if (delErr) {
        console.error(
          `orphan delete failed for ${row.title} (${row.dam_request_no}):`,
          delErr,
        );
        stats.errors++;
        continue;
      }
      orphanDeleted++;
    }
  }

  const { count: total, error: countErr } = await supabase
    .from("songs")
    .select("*", { count: "exact", head: true });
  if (countErr) {
    console.error("post-merge count failed:", countErr);
    process.exit(1);
  }

  console.log(
    `\ndone. inserted=${stats.inserted} updated=${stats.updated} ` +
    `dups_deleted=${stats.duplicatesDeleted} range_filled=${stats.rangeFilled} ` +
    `orphan_deleted=${orphanDeleted} orphan_cleared=${orphanCleared} ` +
    `errors=${stats.errors}\ntable_total=${total}`,
  );

  if (stats.errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

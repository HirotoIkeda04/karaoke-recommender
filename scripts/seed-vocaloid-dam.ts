/**
 * scraper/output/vocaloid_dam_seed.json (DAM ボカロ月間ランキング 105 曲) を
 * Supabase に投入する。
 *
 * 実行: pnpm seed:vocaloid-dam
 *
 * 投入仕様:
 *   - artists: name_norm (NFKC + lower + whitespace 正規化) で名寄せ。
 *     新規 artist は genres=['vocaloid_utaite'] で INSERT (DAM ボカロ月間 由来は
 *     ほぼ確実にボカロ・歌い手系のため)。
 *   - songs: dam_request_no UNIQUE で冪等。既存 (title, artist) ヒット時は
 *     dam_request_no と source_urls を merge。新規は match_status='pending'。
 *   - Spotify enrichment は別ステップ (`pnpm match:dam` 等) に委ねる。
 *     この時点では spotify_track_id, image_url_*, range_*_midi は NULL。
 *
 * 同名異アーティスト (例: 既存 'DECO*27' と新規 'DECO*27') は name_norm で
 * 必ず同じになるため自動的にマージされる。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type SongInsert = Database["public"]["Tables"]["songs"]["Insert"];

interface SeedRow {
  title: string;
  artist: string;
  dam_request_no: string;
  source_pages: string[];
}

interface SeedFile {
  songs: SeedRow[];
  metadata: { source_html: string; source_pages: string[]; total_count: number };
}

function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function damSourceUrl(requestNo: string): string {
  return `https://www.clubdam.com/karaokesearch/songleaf.html?requestNo=${requestNo}`;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const seedPath = resolve(
    process.cwd(),
    "scraper/output/vocaloid_dam_seed.json",
  );
  const seed: SeedFile = JSON.parse(readFileSync(seedPath, "utf-8"));
  console.log(
    `loaded ${seed.songs.length} DAM vocaloid songs (source=${seed.metadata.source_html})${dryRun ? " [DRY-RUN]" : ""}`,
  );

  const sb = createAdminClient() as any;

  // ---------- 1. artists テーブルを準備 ----------
  const seedArtists = Array.from(new Set(seed.songs.map((s) => s.artist)));
  const artistByNorm = new Map<string, { id: string; name: string }>();

  // 既存 artist を name_norm で全件取得 (1059 行 → 1 ページで足りる)
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from("artists")
        .select("id, name, name_norm")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const a of data) artistByNorm.set(a.name_norm, { id: a.id, name: a.name });
      if (data.length < PAGE) break;
    }
  }

  let artistsCreated = 0;
  for (const name of seedArtists) {
    const norm = normalizeArtistName(name);
    if (artistByNorm.has(norm)) continue;
    if (dryRun) {
      console.log(`  [dry] would create artist: ${name}`);
      // dry-run でも後続マッピングが必要なので疑似 id を入れる
      artistByNorm.set(norm, { id: `dry-${artistsCreated}`, name });
      artistsCreated++;
      continue;
    }
    const { data, error } = await sb
      .from("artists")
      .insert({
        name,
        name_norm: norm,
        genres: ["vocaloid_utaite"],
      })
      .select("id, name")
      .single();
    if (error) {
      // 競合 (並行実行) → 取り直し
      if (error.code === "23505") {
        const { data: refetch } = await sb
          .from("artists")
          .select("id, name")
          .eq("name_norm", norm)
          .single();
        if (refetch) artistByNorm.set(norm, { id: refetch.id, name: refetch.name });
      } else {
        console.error(`  ✗ artist insert failed for ${name}:`, error.message);
      }
      continue;
    }
    artistByNorm.set(norm, { id: data.id, name: data.name });
    artistsCreated++;
  }
  console.log(`  artists: ${seedArtists.length} unique in seed, ${artistsCreated} newly created`);

  // ---------- 2. songs を投入 ----------
  // 2-a. 既存 dam_request_no を取得 (skip 用)
  const existingDamReqNos = new Set<string>();
  {
    const reqNos = seed.songs.map((s) => s.dam_request_no);
    const CHUNK = 200;
    for (let i = 0; i < reqNos.length; i += CHUNK) {
      const slice = reqNos.slice(i, i + CHUNK);
      const { data, error } = await sb
        .from("songs")
        .select("dam_request_no")
        .in("dam_request_no", slice);
      if (error) throw error;
      for (const r of data ?? []) existingDamReqNos.add(r.dam_request_no);
    }
  }

  let inserted = 0;
  let mergedExisting = 0;
  let skippedDuplicateDamNo = 0;
  let errors = 0;

  for (const [i, s] of seed.songs.entries()) {
    if (existingDamReqNos.has(s.dam_request_no)) {
      skippedDuplicateDamNo++;
      continue;
    }

    // (title, artist) で既存行 (主に Spotify 経由で先に入っているケース) を検索
    const { data: matches, error: selErr } = await sb
      .from("songs")
      .select("id, source_urls, dam_request_no")
      .eq("title", s.title)
      .eq("artist", s.artist);
    if (selErr) {
      console.error(`  ✗ select failed for ${s.title}:`, selErr.message);
      errors++;
      continue;
    }

    if (matches && matches.length > 0) {
      // 既存行に dam_request_no と source_urls をマージ
      const target = matches[0];
      if (target.dam_request_no) {
        // 既に DAM 連携済 → スキップ (=他のキーで投入済)
        skippedDuplicateDamNo++;
        continue;
      }
      const newUrls = Array.from(
        new Set([...(target.source_urls ?? []), damSourceUrl(s.dam_request_no)]),
      );
      if (dryRun) {
        mergedExisting++;
        continue;
      }
      const { error: updErr } = await sb
        .from("songs")
        .update({
          dam_request_no: s.dam_request_no,
          source_urls: newUrls,
          is_popular: true,
        })
        .eq("id", target.id);
      if (updErr) {
        console.error(`  ✗ merge failed for ${s.title}:`, updErr.message);
        errors++;
      } else {
        mergedExisting++;
      }
      continue;
    }

    // 新規 INSERT
    const norm = normalizeArtistName(s.artist);
    const artist = artistByNorm.get(norm);
    if (!artist) {
      // 直前の dry-run でない artist 作成失敗ケース。スキップ。
      console.error(`  ✗ artist not resolved for ${s.artist}`);
      errors++;
      continue;
    }
    const row: SongInsert = {
      title: s.title,
      artist: s.artist,
      artist_id: dryRun && artist.id.startsWith("dry-") ? null : artist.id,
      release_year: null,
      range_low_midi: null,
      range_high_midi: null,
      falsetto_max_midi: null,
      spotify_track_id: null,
      image_url_large: null,
      image_url_medium: null,
      image_url_small: null,
      source_urls: [damSourceUrl(s.dam_request_no)],
      is_popular: true,
      match_status: "pending",
      dam_request_no: s.dam_request_no,
    };
    if (dryRun) {
      inserted++;
      continue;
    }
    const { error: insErr } = await sb.from("songs").insert(row);
    if (insErr) {
      console.error(`  ✗ insert failed for ${s.title}/${s.artist}:`, insErr.message);
      errors++;
      continue;
    }
    inserted++;

    if ((i + 1) % 25 === 0) {
      console.log(
        `  progress ${i + 1}/${seed.songs.length}: inserted=${inserted} merged=${mergedExisting} dup_skip=${skippedDuplicateDamNo} errors=${errors}`,
      );
    }
  }

  console.log(
    `\n=== 完了${dryRun ? " (DRY-RUN)" : ""} ===\n` +
      `artists newly created : ${artistsCreated}\n` +
      `songs inserted        : ${inserted}\n` +
      `songs merged into existing: ${mergedExisting}\n` +
      `skipped (already linked): ${skippedDuplicateDamNo}\n` +
      `errors                : ${errors}`,
  );

  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

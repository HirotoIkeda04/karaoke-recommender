/**
 * songs.artist_id が NULL の行を、artists.name_norm マッチで一括 backfill する。
 *
 * 経緯:
 *   migrations/011_artists_and_genres.sql の artist_id バックフィルは初回しか
 *   走らないため、後から追加された seed 行 / 名寄せ漏れ行は artist_id=NULL の
 *   まま残り、ジャンル別ビューやアーティスト集計で漏れる (例: YOASOBI の
 *   「アイドル」ほか旧 karaoto seed 7 曲が UI に出ない)。
 *
 * 実行:
 *   pnpm backfill:artist-id           # 実行
 *   pnpm backfill:artist-id -- --dry  # 対象件数確認のみ
 *
 * 仕様:
 *   - 既存 artist と name_norm 一致なら artist_id を埋める
 *   - 一致しないものは artist 行を新規作成 (genres=[]) してから埋める
 *     (既存 normalize 規則と整合)
 */
import { createAdminClient } from "../src/lib/supabase/admin";

// migrations/033_strict_normalize_artist_name.sql と同等
function normalizeArtistName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\.\-_,'"!?·•・/\\()\[\]{}（）「」『』【】]+/g, "");
}

async function main() {
  const dry = process.argv.includes("--dry");
  const sb = createAdminClient() as any;

  // 1. artist_id=NULL の songs を全部取得
  const orphans: { id: string; title: string; artist: string }[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("songs")
      .select("id, title, artist")
      .is("artist_id", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    orphans.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`artist_id=NULL の songs: ${orphans.length} 行`);

  if (orphans.length === 0) {
    console.log("nothing to do.");
    return;
  }

  // 2. 既存 artists を全件 (name_norm → id) で取得
  const artistByNorm = new Map<string, { id: string; name: string }>();
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
  console.log(`既存 artists: ${artistByNorm.size}`);

  // 3. 各 orphan を分類
  const matched: { song_id: string; artist_id: string; song: string; artist: string }[] = [];
  const needNewArtist = new Map<string, { name: string; songs: { id: string; title: string }[] }>();
  for (const s of orphans) {
    const norm = normalizeArtistName(s.artist);
    const a = artistByNorm.get(norm);
    if (a) {
      matched.push({ song_id: s.id, artist_id: a.id, song: s.title, artist: a.name });
    } else {
      const e = needNewArtist.get(norm);
      if (e) e.songs.push({ id: s.id, title: s.title });
      else needNewArtist.set(norm, { name: s.artist, songs: [{ id: s.id, title: s.title }] });
    }
  }
  console.log(`既存 artists にマッチ: ${matched.length} 行`);
  console.log(`新規 artist 作成必要 : ${needNewArtist.size} 名 (合計 ${[...needNewArtist.values()].reduce((n, e) => n + e.songs.length, 0)} 行)`);

  if (dry) {
    console.log("\n--- 新規作成予定の artists (上位30) ---");
    const sorted = [...needNewArtist.values()].sort((a, b) => b.songs.length - a.songs.length);
    for (const e of sorted.slice(0, 30)) {
      console.log(`  ${String(e.songs.length).padStart(3)} 曲  ${e.name}`);
    }
    return;
  }

  // 4. 新規 artist を作成
  let createdArtists = 0;
  for (const [norm, e] of needNewArtist) {
    const { data, error } = await sb
      .from("artists")
      .insert({ name: e.name, name_norm: norm, genres: [] })
      .select("id")
      .single();
    if (error) {
      // 競合 → 取り直し
      if (error.code === "23505") {
        const { data: refetch } = await sb
          .from("artists")
          .select("id, name")
          .eq("name_norm", norm)
          .single();
        if (refetch) artistByNorm.set(norm, { id: refetch.id, name: refetch.name });
      } else {
        console.error(`✗ artist insert failed for ${e.name}: ${error.message}`);
        continue;
      }
    } else {
      artistByNorm.set(norm, { id: data.id, name: e.name });
      createdArtists++;
    }
    // 紐付け対象に追加
    const aid = artistByNorm.get(norm)!.id;
    for (const s of e.songs) {
      matched.push({ song_id: s.id, artist_id: aid, song: s.title, artist: e.name });
    }
  }
  console.log(`新規 artists 作成: ${createdArtists}`);

  // 5. songs.artist_id を一括更新
  let updated = 0;
  let failed = 0;
  for (const m of matched) {
    const { error } = await sb
      .from("songs")
      .update({ artist_id: m.artist_id })
      .eq("id", m.song_id);
    if (error) {
      console.error(`✗ update failed for ${m.song} / ${m.artist}: ${error.message}`);
      failed++;
    } else {
      updated++;
    }
    if (updated % 100 === 0 && updated > 0) {
      console.log(`  progress: ${updated}/${matched.length}`);
    }
  }
  console.log(`\n=== 完了 ===\nartist_id 設定: ${updated}\n失敗      : ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

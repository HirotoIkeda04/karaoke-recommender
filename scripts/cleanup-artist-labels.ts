/**
 * 同一 artist_id 配下で songs.artist 表記が揺れているアーティストの一括クリーンアップ。
 *
 *   1. (artist_id, title) で重複している楽曲のうち
 *        - spotify_track_id IS NOT NULL の行を winner
 *        - spotify_track_id IS NULL の行を loser
 *      として、loser を参照する evaluations / user_known_songs を winner へ付け替えてから loser 行を DELETE する。
 *      (両方 NULL もしくは両方 NOT NULL の場合はスキップしてログ出力。手動対応とする)
 *   2. その後、全アーティストの songs.artist を artists.name に揃える。
 *
 * scripts/find-artist-label-mismatches.ts で対象 9 件を確認済み:
 *   - 大塚 愛 / Mrs. GREEN APPLE / 藤井 風 / 秦基博 (重複あり)
 *   - trf / E-girls / Misia / テレサ・テン / ＝LOVE      (ラベル揺れのみ)
 */
import { createAdminClient } from "../src/lib/supabase/admin";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  spotify_track_id: string | null;
}

async function fetchAllSongs(sb: ReturnType<typeof createAdminClient>): Promise<SongRow[]> {
  const PAGE = 1000;
  const acc: SongRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("songs")
      .select("id, title, artist, artist_id, spotify_track_id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    acc.push(...(data as SongRow[]));
    if (data.length < PAGE) break;
  }
  return acc;
}

async function moveAndDelete(
  sb: ReturnType<typeof createAdminClient>,
  loser: SongRow,
  winner: SongRow,
) {
  let evalMoved = 0,
    evalDeleted = 0,
    knownMoved = 0,
    knownDeleted = 0;

  // evaluations
  const { data: evalsLoser } = await sb
    .from("evaluations")
    .select("user_id, song_id")
    .eq("song_id", loser.id);
  if (evalsLoser && evalsLoser.length) {
    const { data: evalsWinner } = await sb
      .from("evaluations")
      .select("user_id")
      .eq("song_id", winner.id);
    const winnerUsers = new Set((evalsWinner ?? []).map((e) => e.user_id));
    for (const ev of evalsLoser) {
      if (winnerUsers.has(ev.user_id)) {
        const { error } = await sb
          .from("evaluations")
          .delete()
          .eq("user_id", ev.user_id)
          .eq("song_id", loser.id);
        if (error) throw error;
        evalDeleted++;
      } else {
        const { error } = await sb
          .from("evaluations")
          .update({ song_id: winner.id })
          .eq("user_id", ev.user_id)
          .eq("song_id", loser.id);
        if (error) throw error;
        evalMoved++;
      }
    }
  }

  // user_known_songs
  const { data: knownLoser } = await sb
    .from("user_known_songs")
    .select("user_id, song_id, source")
    .eq("song_id", loser.id);
  if (knownLoser && knownLoser.length) {
    const { data: knownWinner } = await sb
      .from("user_known_songs")
      .select("user_id, source")
      .eq("song_id", winner.id);
    const winnerKeys = new Set((knownWinner ?? []).map((k) => `${k.user_id}\t${k.source}`));
    for (const k of knownLoser) {
      const key = `${k.user_id}\t${k.source}`;
      if (winnerKeys.has(key)) {
        const { error } = await sb
          .from("user_known_songs")
          .delete()
          .eq("user_id", k.user_id)
          .eq("song_id", loser.id)
          .eq("source", k.source);
        if (error) throw error;
        knownDeleted++;
      } else {
        const { error } = await sb
          .from("user_known_songs")
          .update({ song_id: winner.id })
          .eq("user_id", k.user_id)
          .eq("song_id", loser.id)
          .eq("source", k.source);
        if (error) throw error;
        knownMoved++;
      }
    }
  }

  // delete loser
  const { error: delErr } = await sb.from("songs").delete().eq("id", loser.id);
  if (delErr) throw delErr;

  return { evalMoved, evalDeleted, knownMoved, knownDeleted };
}

async function main() {
  const sb = createAdminClient();

  // 1. 対象アーティスト集合を求める
  const all = await fetchAllSongs(sb);
  const byArtistId = new Map<string, SongRow[]>();
  for (const s of all) {
    if (!s.artist_id) continue;
    if (!byArtistId.has(s.artist_id)) byArtistId.set(s.artist_id, []);
    byArtistId.get(s.artist_id)!.push(s);
  }

  const targetIds: string[] = [];
  for (const [aid, songs] of byArtistId) {
    const labels = new Set(songs.map((s) => s.artist));
    if (labels.size > 1) targetIds.push(aid);
  }
  console.log(`target artists with mismatched labels: ${targetIds.length}`);

  // canonical name 取得
  const idToName = new Map<string, string>();
  for (let i = 0; i < targetIds.length; i += 500) {
    const slice = targetIds.slice(i, i + 500);
    const { data, error } = await sb.from("artists").select("id, name").in("id", slice);
    if (error) throw error;
    for (const r of data ?? []) idToName.set(r.id as string, r.name as string);
  }

  // 2. 各アーティストごとに dedupe → relabel
  let totalEvalMoved = 0,
    totalEvalDeleted = 0,
    totalKnownMoved = 0,
    totalKnownDeleted = 0,
    totalSongsDeleted = 0,
    totalRelabeled = 0;
  const skipped: { aid: string; title: string; reason: string }[] = [];

  for (const aid of targetIds) {
    const name = idToName.get(aid) ?? "?";
    const songs = byArtistId.get(aid)!;
    console.log(`\n=== [${name}] (id=${aid}) songs=${songs.length} ===`);

    // dedupe
    const byTitle = new Map<string, SongRow[]>();
    for (const s of songs) {
      if (!byTitle.has(s.title)) byTitle.set(s.title, []);
      byTitle.get(s.title)!.push(s);
    }
    for (const [title, group] of byTitle) {
      if (group.length < 2) continue;
      const filled = group.filter((g) => g.spotify_track_id);
      const nulls = group.filter((g) => !g.spotify_track_id);
      if (filled.length === 1 && nulls.length === group.length - 1) {
        const winner = filled[0];
        for (const loser of nulls) {
          console.log(`  dedupe [${title}] loser=${loser.id} -> winner=${winner.id}`);
          const r = await moveAndDelete(sb, loser, winner);
          totalEvalMoved += r.evalMoved;
          totalEvalDeleted += r.evalDeleted;
          totalKnownMoved += r.knownMoved;
          totalKnownDeleted += r.knownDeleted;
          totalSongsDeleted++;
        }
      } else {
        console.log(
          `  SKIP [${title}] filled=${filled.length} nulls=${nulls.length}  (要手動対応)`,
        );
        skipped.push({ aid, title, reason: `filled=${filled.length} nulls=${nulls.length}` });
      }
    }

    // relabel: songs.artist != artists.name の行を更新
    const { count, error: relErr } = await sb
      .from("songs")
      .update({ artist: name }, { count: "exact" })
      .eq("artist_id", aid)
      .neq("artist", name);
    if (relErr) throw relErr;
    console.log(`  relabel to "${name}": ${count}`);
    totalRelabeled += count ?? 0;
  }

  console.log("\n=== summary ===");
  console.log(`  evaluations moved   : ${totalEvalMoved}`);
  console.log(`  evaluations deleted : ${totalEvalDeleted}`);
  console.log(`  user_known moved    : ${totalKnownMoved}`);
  console.log(`  user_known deleted  : ${totalKnownDeleted}`);
  console.log(`  songs deleted       : ${totalSongsDeleted}`);
  console.log(`  songs relabeled     : ${totalRelabeled}`);
  if (skipped.length) {
    console.log(`\n  SKIPPED (manual review needed):`);
    for (const s of skipped) console.log(`    - ${s.aid} title="${s.title}"  ${s.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

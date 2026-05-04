/**
 * 嵐 アーティスト配下の重複曲解消 + songs.artist ラベル正規化
 *
 * 1. (artist_id=嵐, title) で同じ曲が
 *      旧: artist="嵐(アラシ)" / spotify_track_id=NULL
 *      新: artist="嵐"        / spotify_track_id NOT NULL
 *    の 2 行に分かれているケースを 4 件解消する。
 *    旧→新 へ evaluations / user_known_songs を付け替えてから旧を DELETE。
 *
 * 2. 残った songs.artist = "嵐(アラシ)" を "嵐" に揃える。
 */
import { createAdminClient } from "../src/lib/supabase/admin";

const ARASHI_ARTIST_ID = "1834b581-1105-46fe-9795-7ed797d7400a";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  spotify_track_id: string | null;
}

async function main() {
  const sb = createAdminClient();

  // 1. 嵐 配下の全曲取得
  const { data: songs, error } = await sb
    .from("songs")
    .select("id, title, artist, spotify_track_id")
    .eq("artist_id", ARASHI_ARTIST_ID);
  if (error) throw error;

  const all = (songs ?? []) as SongRow[];
  const byTitle = new Map<string, SongRow[]>();
  for (const s of all) {
    if (!byTitle.has(s.title)) byTitle.set(s.title, []);
    byTitle.get(s.title)!.push(s);
  }

  // 重複ペア (旧: spotify=null, 新: spotify NOT NULL)
  const dupes: { loser: SongRow; winner: SongRow }[] = [];
  for (const [, group] of byTitle) {
    if (group.length < 2) continue;
    const winner = group.find((g) => g.spotify_track_id);
    const loser = group.find((g) => !g.spotify_track_id);
    if (winner && loser) dupes.push({ winner, loser });
  }
  console.log(`duplicate pairs: ${dupes.length}`);

  let evalMoved = 0,
    evalDeleted = 0,
    knownMoved = 0,
    knownDeleted = 0,
    songsDeleted = 0;

  for (const { winner, loser } of dupes) {
    console.log(`\n[${loser.title}] loser=${loser.id} -> winner=${winner.id}`);

    // evaluations
    const { data: evalsLoser } = await sb
      .from("evaluations")
      .select("user_id, song_id, rating, memo, created_at, updated_at")
      .eq("song_id", loser.id);
    if (evalsLoser && evalsLoser.length) {
      const { data: evalsWinner } = await sb
        .from("evaluations")
        .select("user_id")
        .eq("song_id", winner.id);
      const winnerUsers = new Set((evalsWinner ?? []).map((e) => e.user_id));
      for (const ev of evalsLoser) {
        if (winnerUsers.has(ev.user_id)) {
          const { error: e1 } = await sb
            .from("evaluations")
            .delete()
            .eq("user_id", ev.user_id)
            .eq("song_id", loser.id);
          if (e1) throw e1;
          evalDeleted++;
        } else {
          const { error: e2 } = await sb
            .from("evaluations")
            .update({ song_id: winner.id })
            .eq("user_id", ev.user_id)
            .eq("song_id", loser.id);
          if (e2) throw e2;
          evalMoved++;
        }
      }
    }

    // user_known_songs
    const { data: knownLoser } = await sb
      .from("user_known_songs")
      .select("user_id, song_id, source, rank, last_seen")
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
          const { error: e1 } = await sb
            .from("user_known_songs")
            .delete()
            .eq("user_id", k.user_id)
            .eq("song_id", loser.id)
            .eq("source", k.source);
          if (e1) throw e1;
          knownDeleted++;
        } else {
          const { error: e2 } = await sb
            .from("user_known_songs")
            .update({ song_id: winner.id })
            .eq("user_id", k.user_id)
            .eq("song_id", loser.id)
            .eq("source", k.source);
          if (e2) throw e2;
          knownMoved++;
        }
      }
    }

    // delete loser song row
    const { error: dErr } = await sb.from("songs").delete().eq("id", loser.id);
    if (dErr) throw dErr;
    songsDeleted++;
  }

  // 2. songs.artist = "嵐(アラシ)" を "嵐" に正規化
  const { count: relabelCount, error: relErr } = await sb
    .from("songs")
    .update({ artist: "嵐" }, { count: "exact" })
    .eq("artist_id", ARASHI_ARTIST_ID)
    .eq("artist", "嵐(アラシ)");
  if (relErr) throw relErr;

  console.log("\n=== summary ===");
  console.log(`  evaluations moved   : ${evalMoved}`);
  console.log(`  evaluations deleted : ${evalDeleted}`);
  console.log(`  user_known moved    : ${knownMoved}`);
  console.log(`  user_known deleted  : ${knownDeleted}`);
  console.log(`  songs deleted       : ${songsDeleted}`);
  console.log(`  songs.artist relabeled to "嵐": ${relabelCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

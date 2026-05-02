/**
 * (title, artist) が同一なのに片方が spotify_track_id=NULL、もう片方が
 * NOT NULL になっている重複行を解消する。
 *
 * 解消手順:
 * 1. NULL 行 (旧) を参照している evaluations / user_known_songs を
 *    NOT NULL 行 (新) に付け替える(同じユーザーが両方に持っていれば NULL 側を捨てる)
 * 2. NULL 行を削除
 *
 * 原因: seed-songs.ts の upsert は `onConflict: spotify_track_id` のため、
 * 既存 NULL 行とは衝突せず INSERT になり、(title, artist) 二重持ちになっていた。
 */
import { createAdminClient } from "../src/lib/supabase/admin";

interface SongRow {
  id: string;
  title: string;
  artist: string;
  spotify_track_id: string | null;
}

async function fetchAll(
  sb: ReturnType<typeof createAdminClient>,
  filter: "null" | "not_null",
): Promise<SongRow[]> {
  const PAGE = 1000;
  const acc: SongRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from("songs")
      .select("id, title, artist, spotify_track_id")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    q = filter === "null"
      ? q.is("spotify_track_id", null)
      : q.not("spotify_track_id", "is", null);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    acc.push(...(data as SongRow[]));
    if (data.length < PAGE) break;
  }
  return acc;
}

async function main() {
  const sb = createAdminClient();

  const nulls = await fetchAll(sb, "null");
  const filled = await fetchAll(sb, "not_null");
  console.log(`fetched: null=${nulls.length}, filled=${filled.length}`);

  const filledByKey = new Map<string, SongRow>(
    filled.map((r) => [`${r.title}\t${r.artist}`, r]),
  );
  const dupes: Array<{ nullRow: SongRow; filledRow: SongRow }> = [];
  for (const n of nulls) {
    const f = filledByKey.get(`${n.title}\t${n.artist}`);
    if (f) dupes.push({ nullRow: n, filledRow: f });
  }
  console.log(`duplicate pairs to resolve: ${dupes.length}`);

  let evalMoved = 0;
  let evalDeleted = 0;
  let knownMoved = 0;
  let knownDeleted = 0;
  let songsDeleted = 0;

  for (const { nullRow, filledRow } of dupes) {
    // --- evaluations ---
    const { data: evalsNull } = await sb
      .from("evaluations")
      .select("user_id, song_id, rating, memo, created_at, updated_at")
      .eq("song_id", nullRow.id);
    if (evalsNull && evalsNull.length > 0) {
      const { data: evalsFilled } = await sb
        .from("evaluations")
        .select("user_id")
        .eq("song_id", filledRow.id);
      const filledUsers = new Set((evalsFilled ?? []).map((e) => e.user_id));
      for (const ev of evalsNull) {
        if (filledUsers.has(ev.user_id)) {
          // すでに新行側にある: 旧側を削除
          const { error } = await sb
            .from("evaluations")
            .delete()
            .eq("user_id", ev.user_id)
            .eq("song_id", nullRow.id);
          if (error) throw error;
          evalDeleted++;
        } else {
          const { error } = await sb
            .from("evaluations")
            .update({ song_id: filledRow.id })
            .eq("user_id", ev.user_id)
            .eq("song_id", nullRow.id);
          if (error) throw error;
          evalMoved++;
        }
      }
    }

    // --- user_known_songs ---
    const { data: knownNull } = await sb
      .from("user_known_songs")
      .select("user_id, song_id, source, rank, last_seen")
      .eq("song_id", nullRow.id);
    if (knownNull && knownNull.length > 0) {
      const { data: knownFilled } = await sb
        .from("user_known_songs")
        .select("user_id, source")
        .eq("song_id", filledRow.id);
      const filledKeys = new Set(
        (knownFilled ?? []).map((k) => `${k.user_id}\t${k.source}`),
      );
      for (const k of knownNull) {
        const compositeKey = `${k.user_id}\t${k.source}`;
        if (filledKeys.has(compositeKey)) {
          const { error } = await sb
            .from("user_known_songs")
            .delete()
            .eq("user_id", k.user_id)
            .eq("song_id", nullRow.id)
            .eq("source", k.source);
          if (error) throw error;
          knownDeleted++;
        } else {
          const { error } = await sb
            .from("user_known_songs")
            .update({ song_id: filledRow.id })
            .eq("user_id", k.user_id)
            .eq("song_id", nullRow.id)
            .eq("source", k.source);
          if (error) throw error;
          knownMoved++;
        }
      }
    }

    // --- songs (null 行) ---
    const { error: delErr } = await sb
      .from("songs")
      .delete()
      .eq("id", nullRow.id);
    if (delErr) throw delErr;
    songsDeleted++;
  }

  console.log("done.");
  console.log(`  evaluations moved   : ${evalMoved}`);
  console.log(`  evaluations deleted : ${evalDeleted}`);
  console.log(`  user_known moved    : ${knownMoved}`);
  console.log(`  user_known deleted  : ${knownDeleted}`);
  console.log(`  songs deleted       : ${songsDeleted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

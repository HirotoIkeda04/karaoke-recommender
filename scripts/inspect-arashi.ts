/**
 * 嵐 アーティストの現状確認:
 *  - 「嵐」を含むアーティスト一覧
 *  - artist_id 配下の重複曲
 *  - songs.artist が "嵐(アラシ)" の全行（重複でないものも含む）
 */
import { createAdminClient } from "../src/lib/supabase/admin";

async function main() {
  const sb = createAdminClient();

  const { data: artists, error: aErr } = await sb
    .from("artists")
    .select("id, name, name_norm, genres")
    .ilike("name", "%嵐%");
  if (aErr) throw aErr;
  console.log("Artists matching 嵐:");
  for (const a of artists ?? []) {
    console.log(`  id=${a.id}  name="${a.name}"  norm="${a.name_norm}"  genres=${JSON.stringify(a.genres)}`);
  }

  const arashiId = artists?.find((a) => a.name === "嵐")?.id;
  if (!arashiId) {
    console.log("No 嵐 artist found");
    return;
  }

  const { data: songs, error: sErr } = await sb
    .from("songs")
    .select("id, title, artist, spotify_track_id")
    .eq("artist_id", arashiId)
    .order("title", { ascending: true });
  if (sErr) throw sErr;

  // Distinct artist strings
  const labels = new Map<string, number>();
  for (const s of songs ?? []) labels.set(s.artist, (labels.get(s.artist) ?? 0) + 1);
  console.log(`\nDistinct songs.artist labels under 嵐 (id=${arashiId}):`);
  for (const [k, v] of labels) console.log(`  "${k}" : ${v}`);

  // Duplicate-by-title
  const byTitle = new Map<string, typeof songs>();
  for (const s of songs ?? []) {
    if (!byTitle.has(s.title)) byTitle.set(s.title, [] as any);
    byTitle.get(s.title)!.push(s);
  }
  const dupes = [...byTitle.entries()].filter(([, v]) => (v?.length ?? 0) > 1);
  console.log(`\nDuplicate-by-title groups: ${dupes.length}`);
  for (const [title, group] of dupes) {
    console.log(`  [${title}]`);
    for (const s of group ?? []) {
      console.log(`    - id=${s.id}  artist="${s.artist}"  spotify=${s.spotify_track_id}`);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

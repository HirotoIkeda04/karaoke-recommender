/**
 * 同一 artist_id 配下で songs.artist 表記が複数存在するケースを検出。
 *
 * 加えて、(artist_id, title) で重複している楽曲も列挙する。
 * 嵐 と同じ症状(マージ後にラベルがバラついて重複が残っている)を網羅的に拾う。
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

async function main() {
  const sb = createAdminClient();

  const all = await fetchAllSongs(sb);
  console.log(`total songs: ${all.length}`);

  // artist_id ごとに songs.artist の集合を作る
  const byArtistId = new Map<string, Map<string, SongRow[]>>();
  for (const s of all) {
    if (!s.artist_id) continue;
    if (!byArtistId.has(s.artist_id)) byArtistId.set(s.artist_id, new Map());
    const labels = byArtistId.get(s.artist_id)!;
    if (!labels.has(s.artist)) labels.set(s.artist, []);
    labels.get(s.artist)!.push(s);
  }

  // 表記が 2 種類以上ある artist_id を抽出
  const mismatched = [...byArtistId.entries()].filter(([, labels]) => labels.size > 1);
  console.log(`\nartist_id with multiple songs.artist labels: ${mismatched.length}`);

  // artist 表示名取得
  const artistIds = mismatched.map(([id]) => id);
  const idToName = new Map<string, string>();
  for (let i = 0; i < artistIds.length; i += 500) {
    const slice = artistIds.slice(i, i + 500);
    const { data, error } = await sb.from("artists").select("id, name").in("id", slice);
    if (error) throw error;
    for (const r of data ?? []) idToName.set(r.id as string, r.name as string);
  }

  // タイトル重複検出も同時に
  for (const [aid, labels] of mismatched) {
    const songs = [...labels.values()].flat();
    const byTitle = new Map<string, SongRow[]>();
    for (const s of songs) {
      if (!byTitle.has(s.title)) byTitle.set(s.title, []);
      byTitle.get(s.title)!.push(s);
    }
    const dupes = [...byTitle.entries()].filter(([, v]) => v.length > 1);

    console.log(
      `\n[${idToName.get(aid) ?? "?"}] (id=${aid}) songs=${songs.length}  labels=${labels.size}  title-dupes=${dupes.length}`,
    );
    const labelSummary = [...labels.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([k, v]) => `"${k}":${v.length}`)
      .join("  ");
    console.log(`  labels: ${labelSummary}`);
    for (const [title, group] of dupes) {
      console.log(`  dup [${title}]`);
      for (const s of group) {
        console.log(
          `    - id=${s.id}  artist="${s.artist}"  spotify=${s.spotify_track_id ?? "NULL"}`,
        );
      }
    }
  }

  // (artist_id IS NULL で artist 列にゴミがある or 同一の) ケースも一応チェック
  const nullArtistIdSongs = all.filter((s) => !s.artist_id);
  console.log(`\nsongs with artist_id=NULL: ${nullArtistIdSongs.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ============================================================================
// 重複アーティストの手動マージ 第 2 弾 (2026-08-12, 一回限り)
// ============================================================================
// ホームで「世界の終わり」の組が 2 つ表示された調査で、name 正規化
// (NFKC + 中黒・括弧の揺れ) により 16 組の重複アーティストを検出した。
// KinKi Kids(堂本光一)/(堂本剛) はソロ名義のため意図的に残し、15 組を統合する。
//
// merge-dup-artists.ts (第 1 弾) からの拡張点:
//   - タイトル重複曲の統合 (dedup-songs.ts と同じ優先順で keeper を選び、
//     mergeSongReferences で評価を引き継いでから削除。keeper の欠損フィールド
//     は削除側から補完する)
//   - songs.artist (非正規化表示名) を勝者名に統一
//   - related_artists の参照付け替え (自己参照・重複ペアは削除)
//   - wikidata_qid / wikipedia_article を敗者から引き継ぎ
//
// 使い方:
//   pnpm merge:dup-artists-2 --dry-run
//   pnpm merge:dup-artists-2
// ============================================================================

import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";
import { mergeSongReferences } from "./lib/merge-song-refs";

type RelatedArtistRow =
  Database["public"]["Tables"]["related_artists"]["Row"];
type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];

const DRY = process.argv.slice(2).includes("--dry-run");

// winnerId に loserIds をマージ (勝者 = 正規表記のレコード)
const MERGES: { label: string; winnerId: string; loserIds: string[] }[] = [
  {
    label: "SEKAI NO OWARI",
    winnerId: "38f4064d-19f8-46b2-8975-069a4cdf2087",
    loserIds: [
      "9f93fccf-84ed-4dff-ab25-089d5336c26d", // SEKAI NO OWARI(世界の終わり)
      "aa3d36f8-3eea-428d-b092-7e24cc46f636", // 世界の終わり
    ],
  },
  {
    label: "X JAPAN",
    winnerId: "975d8ec2-9735-429f-ac04-0f7f41b74a19",
    loserIds: ["898f52d1-f064-44f7-a3af-9fad602c9d0f"], // X JAPAN (X)
  },
  {
    label: "AAA",
    winnerId: "6b0f0b9e-4f11-449d-92ff-497dc295101e",
    loserIds: ["9eda517c-d321-4533-a80f-defcd71319ef"], // AAA(トリプル・エー)
  },
  {
    label: "EXILE TRIBE",
    winnerId: "0481a325-54eb-4cf1-932d-1bb424a4dccd",
    loserIds: ["6c8d8f6e-5050-417b-8a91-3213b62b6624"], // (三代目 VS GENERATIONS)
  },
  {
    label: "FIELD OF VIEW",
    winnerId: "1bb56a0b-4d42-47e9-b93d-eab409f7a7cb",
    loserIds: ["42c5f2b9-09f6-45cc-b5fd-1ee14bbd8219"], // (the FIELD OF VIEW)
  },
  {
    label: "Orangestar",
    winnerId: "1c6d4dea-729c-4486-af6e-640ca9d5fb0e",
    loserIds: ["131a8dbd-dbfa-43c8-b2d9-b8e8c4bbdb45"], // (feat. IA & 初音ミク)
  },
  {
    label: "松たか子",
    winnerId: "26c2fc48-0537-4151-b644-f335e023008b",
    loserIds: ["c5629073-4f50-472a-8735-8d3930017f84"], // (featuring オーロラ)
  },
  {
    label: "テレサ・テン",
    winnerId: "d012c04d-7998-44cd-9aae-fbd73e6799c0",
    loserIds: ["4aab327e-1f43-4a77-ae5c-4e0bd98fcf34"], // テレサ･テン
  },
  {
    label: "キム・ヨンジャ",
    winnerId: "44322d92-9dc0-4399-b362-34b3f4fb2cab",
    loserIds: ["33fd37c4-30e6-4505-9d88-ad012ee5fbdd"], // キム･ヨンジャ
  },
  {
    label: "アイナ・ジ・エンド",
    winnerId: "71bd40fa-52e4-4d50-bfaf-13ac9dfbd6e8",
    loserIds: ["fbc7790f-a241-4a63-9304-9534b2d371c4"], // アイナ･ジ･エンド
  },
  {
    label: "川中美幸・弦哲也",
    winnerId: "121c9fcb-b266-4cf0-8c4a-d48f13cedc71",
    loserIds: ["03a856fb-f5af-41fe-a14c-936660ee5bdd"],
  },
  {
    label: "堀内孝雄・桂銀淑",
    winnerId: "92665eeb-f0a9-4cf8-9e3a-cd19ffd5e29a",
    loserIds: ["433c4571-c7a7-4d39-b5a1-34ce8b6ed499"],
  },
  {
    label: "里見浩太朗・横内正",
    winnerId: "46a13c6c-984d-4514-8691-9ac57bb237b9",
    loserIds: ["7ff38bd9-2831-4231-8581-f5ff0b8d2f8e"],
  },
  {
    label: "加山雄三・谷村新司",
    winnerId: "c46a89b6-4698-4bcd-bd9d-0db57db3b4b8",
    loserIds: ["a600d0a7-68b1-4f47-b87f-2eb8f2c5066c"],
  },
  {
    label: "藤谷美和子・大内義昭",
    winnerId: "ba04a0a3-b053-454e-813c-a719de8c39c6",
    loserIds: ["b43c83bd-e1aa-4fe3-b7ea-689d6a53e398"],
  },
];

type Sb = ReturnType<typeof createAdminClient>;

interface SongRow {
  id: string;
  title: string;
  artist: string;
  artist_id: string | null;
  spotify_track_id: string | null;
  image_url_small: string | null;
  image_url_medium: string | null;
  image_url_large: string | null;
  duration_ms: number | null;
  release_year: number | null;
  itunes_preview_url: string | null;
  itunes_track_id: number | null;
  itunes_preview_checked_at: string | null;
  created_at: string;
}

const SONG_COLS =
  "id, title, artist, artist_id, spotify_track_id, " +
  "image_url_small, image_url_medium, image_url_large, duration_ms, " +
  "release_year, itunes_preview_url, itunes_track_id, " +
  "itunes_preview_checked_at, created_at";

/** dedup-songs.ts と同じタイトル正規化 */
function normTitle(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/** evaluations / song_logs / user_known_songs からの参照数 */
async function refCount(sb: Sb, songId: string): Promise<number> {
  const [ev, sl, uk] = await Promise.all([
    sb
      .from("evaluations")
      .select("song_id", { count: "exact", head: true })
      .eq("song_id", songId),
    sb
      .from("song_logs")
      .select("song_id", { count: "exact", head: true })
      .eq("song_id", songId),
    sb
      .from("user_known_songs")
      .select("song_id", { count: "exact", head: true })
      .eq("song_id", songId),
  ]);
  return (ev.count ?? 0) + (sl.count ?? 0) + (uk.count ?? 0);
}

/** keeper の欠損フィールドを loser から補完する差分を作る */
function backfillUpdates(keeper: SongRow, loser: SongRow): SongUpdate {
  const updates: Record<string, unknown> = {};
  const FIELDS: (keyof SongRow)[] = [
    "spotify_track_id",
    "image_url_small",
    "image_url_medium",
    "image_url_large",
    "duration_ms",
    "release_year",
    "itunes_preview_url",
    "itunes_track_id",
    "itunes_preview_checked_at",
  ];
  for (const f of FIELDS) {
    if (keeper[f] == null && loser[f] != null) updates[f] = loser[f];
  }
  return updates as SongUpdate;
}

async function mergeGroup(
  sb: Sb,
  label: string,
  winnerId: string,
  loserIds: string[],
) {
  console.log(`\n===== [${label}] winner=${winnerId}`);
  const allIds = [winnerId, ...loserIds];

  // ---- アーティスト行 ----
  const { data: artistRows, error: aErr } = await sb
    .from("artists")
    .select("id, name, genres, wikidata_qid, wikipedia_article")
    .in("id", allIds);
  if (aErr) throw aErr;
  const winner = artistRows?.find((r) => r.id === winnerId);
  if (!winner) throw new Error(`winner not found: ${winnerId}`);
  const losers = (artistRows ?? []).filter((r) => r.id !== winnerId);
  if (losers.length !== loserIds.length) {
    console.log(
      `  ! loser 行が一部見つからない (期待 ${loserIds.length}, 実際 ${losers.length}) — 既にマージ済み?`,
    );
    if (losers.length === 0) return;
  }

  // genres union + qid/wikipedia 引き継ぎ
  const genres = new Set<string>(winner.genres ?? []);
  let qid = winner.wikidata_qid;
  let wiki = winner.wikipedia_article;
  for (const l of losers) {
    for (const g of l.genres ?? []) genres.add(g);
    qid = qid ?? l.wikidata_qid;
    wiki = wiki ?? l.wikipedia_article;
  }
  const artistUpdates = {
    genres: [...genres].sort(),
    wikidata_qid: qid,
    wikipedia_article: wiki,
  };
  console.log(`  artists update: ${JSON.stringify(artistUpdates)}`);

  // ---- 曲: タイトル重複の統合 ----
  const { data: songRows, error: sErr } = await sb
    .from("songs")
    .select(SONG_COLS)
    .in("artist_id", allIds);
  if (sErr) throw sErr;
  const songs = (songRows ?? []) as unknown as SongRow[];
  const byTitle = new Map<string, SongRow[]>();
  for (const s of songs) {
    const k = normTitle(s.title);
    byTitle.set(k, [...(byTitle.get(k) ?? []), s]);
  }

  const deletedSongIds = new Set<string>();
  for (const [key, group] of byTitle) {
    if (group.length < 2) continue;
    // keeper 優先順: 参照あり > spotify_track_id > 画像 > created_at 古い順
    const scored = await Promise.all(
      group.map(async (s) => ({ s, refs: await refCount(sb, s.id) })),
    );
    scored.sort((a, b) => {
      if ((a.refs > 0) !== (b.refs > 0)) return a.refs > 0 ? -1 : 1;
      const aSp = a.s.spotify_track_id != null;
      const bSp = b.s.spotify_track_id != null;
      if (aSp !== bSp) return aSp ? -1 : 1;
      const aIm = a.s.image_url_medium != null;
      const bIm = b.s.image_url_medium != null;
      if (aIm !== bIm) return aIm ? -1 : 1;
      return a.s.created_at.localeCompare(b.s.created_at);
    });
    const keeper = scored[0].s;
    const dupLosers = scored.slice(1).map((x) => x.s);
    console.log(
      `  dup "${key}": keep ${keeper.id.slice(0, 8)} (refs=${scored[0].refs}), ` +
        `drop ${dupLosers.map((d) => d.id.slice(0, 8)).join(", ")}`,
    );
    for (const d of dupLosers) {
      const updates = backfillUpdates(keeper, d);
      if (Object.keys(updates).length > 0) {
        console.log(`    backfill keeper: ${Object.keys(updates).join(", ")}`);
        if (!DRY) {
          const { error } = await sb
            .from("songs")
            .update(updates)
            .eq("id", keeper.id);
          if (error) throw error;
        }
      }
      if (!DRY) {
        const moved = await mergeSongReferences(sb, d.id, keeper.id);
        console.log(`    refs moved: ${JSON.stringify(moved.moved)}`);
        const { error } = await sb.from("songs").delete().eq("id", d.id);
        if (error) throw error;
      }
      deletedSongIds.add(d.id);
    }
  }

  // ---- 残った敗者側の曲を勝者へ付け替え (表示名も統一) ----
  const moveTargets = songs.filter(
    (s) =>
      s.artist_id !== winnerId &&
      !deletedSongIds.has(s.id) &&
      s.artist_id != null,
  );
  console.log(
    `  reassign ${moveTargets.length} songs -> ${winner.name} (表示名も更新)`,
  );
  if (!DRY && moveTargets.length > 0) {
    const { error } = await sb
      .from("songs")
      .update({ artist_id: winnerId, artist: winner.name })
      .in(
        "id",
        moveTargets.map((s) => s.id),
      );
    if (error) throw error;
  }

  // ---- related_artists の付け替え ----
  const loserSet = new Set(loserIds);
  const [asArtist, asRelated, winAsArtist, winAsRelated] = await Promise.all([
    sb.from("related_artists").select("*").in("artist_id", loserIds),
    sb.from("related_artists").select("*").in("related_artist_id", loserIds),
    sb.from("related_artists").select("*").eq("artist_id", winnerId),
    sb.from("related_artists").select("*").eq("related_artist_id", winnerId),
  ]);
  const existing = new Set<string>(
    [...(winAsArtist.data ?? []), ...(winAsRelated.data ?? [])].map(
      (r) => `${r.artist_id}|${r.related_artist_id}`,
    ),
  );
  // 同一行が両クエリに出得るので id ペアで dedupe
  const touched = new Map<string, RelatedArtistRow>();
  for (const r of [...(asArtist.data ?? []), ...(asRelated.data ?? [])]) {
    touched.set(`${r.artist_id}|${r.related_artist_id}`, r);
  }
  let raMoved = 0;
  let raDropped = 0;
  for (const r of touched.values()) {
    const newA = loserSet.has(r.artist_id) ? winnerId : r.artist_id;
    const newR = loserSet.has(r.related_artist_id)
      ? winnerId
      : r.related_artist_id;
    const newKey = `${newA}|${newR}`;
    if (!DRY) {
      const { error } = await sb
        .from("related_artists")
        .delete()
        .eq("artist_id", r.artist_id)
        .eq("related_artist_id", r.related_artist_id);
      if (error) throw error;
    }
    if (newA === newR || existing.has(newKey)) {
      raDropped++;
      continue;
    }
    existing.add(newKey);
    raMoved++;
    if (!DRY) {
      const { error } = await sb.from("related_artists").insert({
        artist_id: newA,
        related_artist_id: newR,
        rank: r.rank,
      });
      if (error) throw error;
    }
  }
  console.log(`  related_artists: moved=${raMoved}, dropped=${raDropped}`);

  // ---- artist_relationships の付け替え ----
  // related-artists スレッドが導入したテーブル (migration 049)。生成型が
  // まだ無いため any 経由で扱う。ユニーク性は
  // (artist_id, related_artist_id, relationship_type, source) とみなす。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rel = (sb as any).from("artist_relationships");
  interface RelRow {
    artist_id: string;
    related_artist_id: string;
    relationship_type: string;
    source: string;
    confidence: number | null;
    evidence: unknown;
  }
  const [relAsA, relAsR, relWinA, relWinR] = await Promise.all([
    rel.select("*").in("artist_id", loserIds),
    rel.select("*").in("related_artist_id", loserIds),
    rel.select("*").eq("artist_id", winnerId),
    rel.select("*").eq("related_artist_id", winnerId),
  ]);
  if (relAsA.error || relAsR.error) {
    console.log(
      `  artist_relationships: 取得エラーのためスキップ (${relAsA.error?.message ?? relAsR.error?.message})`,
    );
  } else {
    const relKey = (r: RelRow) =>
      `${r.artist_id}|${r.related_artist_id}|${r.relationship_type}|${r.source}`;
    const relExisting = new Set<string>(
      [...(relWinA.data ?? []), ...(relWinR.data ?? [])].map((r: RelRow) =>
        relKey(r),
      ),
    );
    const relTouched = new Map<string, RelRow>();
    for (const r of [...(relAsA.data ?? []), ...(relAsR.data ?? [])]) {
      relTouched.set(relKey(r), r);
    }
    let relMoved = 0;
    let relDropped = 0;
    for (const r of relTouched.values()) {
      const newA = loserSet.has(r.artist_id) ? winnerId : r.artist_id;
      const newR = loserSet.has(r.related_artist_id)
        ? winnerId
        : r.related_artist_id;
      const newKey = `${newA}|${newR}|${r.relationship_type}|${r.source}`;
      if (!DRY) {
        const { error } = await rel
          .delete()
          .eq("artist_id", r.artist_id)
          .eq("related_artist_id", r.related_artist_id)
          .eq("relationship_type", r.relationship_type)
          .eq("source", r.source);
        if (error) throw error;
      }
      if (newA === newR || relExisting.has(newKey)) {
        relDropped++;
        continue;
      }
      relExisting.add(newKey);
      relMoved++;
      if (!DRY) {
        const { error } = await rel.insert({
          artist_id: newA,
          related_artist_id: newR,
          relationship_type: r.relationship_type,
          source: r.source,
          confidence: r.confidence,
          evidence: r.evidence,
        });
        if (error) {
          console.log(`    ! insert 失敗 (${newKey}): ${error.message}`);
          relMoved--;
          relDropped++;
        }
      }
    }
    console.log(`  artist_relationships: moved=${relMoved}, dropped=${relDropped}`);
  }

  // ---- 敗者削除 → 勝者更新 ----
  // wikidata_qid には UNIQUE 制約があるため、敗者が保持している QID を
  // 勝者へ書く前に、先に敗者行を削除して値を解放する。
  if (!DRY) {
    const { error: delErr } = await sb
      .from("artists")
      .delete()
      .in(
        "id",
        losers.map((l) => l.id),
      );
    if (delErr) throw delErr;
    const { error: updErr } = await sb
      .from("artists")
      .update(artistUpdates)
      .eq("id", winnerId);
    if (updErr) throw updErr;
  }
  console.log(`  deleted ${losers.length} loser artist row(s), winner updated`);
}

async function main() {
  console.log(`merge-dup-artists-2 (${DRY ? "DRY-RUN" : "APPLY"})`);
  const sb = createAdminClient();
  for (const m of MERGES) {
    await mergeGroup(sb, m.label, m.winnerId, m.loserIds);
  }
  console.log("\nAll merges complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * 重複アーティスト行を 1 行に統合する共通処理。
 *
 * scripts/merge-dup-artists-2.ts (2026-08-12 の一回限りスクリプト) で組み上げた
 * 手順をそのまま切り出したもの。以後の統合スクリプトはこれを使う。
 *
 * 統合の順序には理由がある:
 *   1. 同一タイトルの曲を先に潰す — 勝者と敗者が同じ曲を持っている場合、
 *      先に artist_id を付け替えると (artist_id, title) が二重になる。
 *      潰す側は mergeSongReferences でユーザー評価を keeper に移してから消す。
 *   2. 残った曲を勝者へ付け替え、非正規化列 songs.artist も勝者名に揃える。
 *   3. related_artists / artist_relationships の参照を付け替え、
 *      自己参照と既存重複は捨てる。
 *   4. 敗者を DELETE してから勝者を UPDATE する。
 *      wikidata_qid は UNIQUE なので、敗者の QID を勝者に引き継ぐには
 *      先に敗者行を消して値を解放しておく必要がある。
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";

import { mergeSongReferences } from "./merge-song-refs";

type Sb = SupabaseClient<Database>;
type SongUpdate = Database["public"]["Tables"]["songs"]["Update"];
type RelatedArtistRow = Database["public"]["Tables"]["related_artists"]["Row"];

export interface MergeArtistsOptions {
  /** true なら DB を一切書き換えず、実行予定だけを log に流す */
  dryRun?: boolean;
  log?: (line: string) => void;
}

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

/**
 * loserIds を winnerId に統合する。
 * 敗者行が既に無い場合は何もせず戻る (再実行しても安全)。
 */
export async function mergeArtists(
  sb: Sb,
  winnerId: string,
  loserIds: string[],
  options: MergeArtistsOptions = {},
): Promise<void> {
  const dry = options.dryRun ?? false;
  const log = options.log ?? ((line: string) => console.log(line));
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
    log(
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
  log(`  artists update: ${JSON.stringify(artistUpdates)}`);

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
      if (a.refs > 0 !== b.refs > 0) return a.refs > 0 ? -1 : 1;
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
    log(
      `  dup "${key}": keep ${keeper.id.slice(0, 8)} (refs=${scored[0].refs}), ` +
        `drop ${dupLosers.map((d) => d.id.slice(0, 8)).join(", ")}`,
    );
    for (const d of dupLosers) {
      const updates = backfillUpdates(keeper, d);
      if (Object.keys(updates).length > 0) {
        log(`    backfill keeper: ${Object.keys(updates).join(", ")}`);
        if (!dry) {
          const { error } = await sb
            .from("songs")
            .update(updates)
            .eq("id", keeper.id);
          if (error) throw error;
        }
      }
      if (!dry) {
        const moved = await mergeSongReferences(sb, d.id, keeper.id);
        log(`    refs moved: ${JSON.stringify(moved.moved)}`);
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
  log(
    `  reassign ${moveTargets.length} songs -> ${winner.name} (表示名も更新)`,
  );
  if (!dry && moveTargets.length > 0) {
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
    if (!dry) {
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
    if (!dry) {
      const { error } = await sb.from("related_artists").insert({
        artist_id: newA,
        related_artist_id: newR,
        rank: r.rank,
      });
      if (error) throw error;
    }
  }
  log(`  related_artists: moved=${raMoved}, dropped=${raDropped}`);

  // ---- artist_relationships の付け替え ----
  // migration 049 で入ったテーブル。生成型がまだ無いため any 経由で扱う。
  // ユニーク性は (artist_id, related_artist_id, relationship_type, source)。
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
    log(
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
      if (!dry) {
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
      if (!dry) {
        const { error } = await rel.insert({
          artist_id: newA,
          related_artist_id: newR,
          relationship_type: r.relationship_type,
          source: r.source,
          confidence: r.confidence,
          evidence: r.evidence,
        });
        if (error) {
          log(`    ! insert 失敗 (${newKey}): ${error.message}`);
          relMoved--;
          relDropped++;
        }
      }
    }
    log(`  artist_relationships: moved=${relMoved}, dropped=${relDropped}`);
  }

  // ---- 敗者削除 → 勝者更新 ----
  // wikidata_qid には UNIQUE 制約があるため、敗者が保持している QID を
  // 勝者へ書く前に、先に敗者行を削除して値を解放する。
  if (!dry) {
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
  log(`  deleted ${losers.length} loser artist row(s), winner updated`);
}

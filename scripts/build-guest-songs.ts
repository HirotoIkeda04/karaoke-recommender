/**
 * 未ログイン (ゲスト) 体験で使う固定曲リストを生成する。
 *
 * ゲストは Supabase に一切アクセスしない。曲データはこのスクリプトが吐く
 * src/data/guest-songs.json をアプリ側から読んで使う。ゲスト用に RLS や
 * GRANT を開けずに済むのはこの構造のおかげなので、ゲストに見せてよい情報
 * だけをここで確定させること。
 *
 * 構成 (2026-08-15 にユーザーと合意):
 *   deck  … ホームのレコードデッキ用。10 アーティスト x 5 曲 = 50 曲。
 *           今週のランキング + J-POP / 邦ロックの有名アーティストから選定。
 *   extra … デッキ外の 20 曲。アニソン / ボカロ / 女性アイドル / 男性アイドル
 *           を各 5 曲。検索とライブラリの幅出し用。
 *
 * デッキのアーティストは自動選定ではなく下の DECK_ARTIST_NAMES で固定する。
 * ゲストの第一印象を左右する枠なので、ランキング変動で勝手に入れ替わらない
 * ようにしてある。曲そのものは知名度順で自動採用するため、再生成すると
 * 新曲が入ることはある。
 *
 * 使い方:
 *   node --import tsx --env-file=.env.local scripts/build-guest-songs.ts --print
 *   node --import tsx --env-file=.env.local scripts/build-guest-songs.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { GUEST_SONG_COLUMNS } from "../src/lib/guest-songs";
import { createAdminClient } from "../src/lib/supabase/admin";
import type { Database } from "../src/types/database";

type Song = Database["public"]["Tables"]["songs"]["Row"];

/** 1 アーティストあたりの曲数 (src/lib/deck.ts の GROUP_SIZE と揃える) */
const SONGS_PER_ARTIST = 5;

/**
 * デッキに積むアーティスト (表示順)。artists.name と完全一致させること。
 * 変更したら --print で全曲を確認してから JSON を再生成する。
 */
const DECK_ARTIST_NAMES = [
  "Mrs. GREEN APPLE",
  "サカナクション",
  "米津玄師",
  "back number",
  "Vaundy",
  "あいみょん",
  "宇多田ヒカル",
  "King Gnu",
  "嵐",
  "Official髭男dism",
] as const;

/** デッキ外の追加枠。ジャンルごとの曲数 */
const EXTRA_GENRES = [
  { genre: "anison", count: 5 },
  { genre: "vocaloid_utaite", count: 5 },
  { genre: "idol_female", count: 5 },
  { genre: "idol_male", count: 5 },
] as const;

/** 同じアーティストで追加枠を埋め尽くさないための上限 */
const EXTRA_MAX_PER_ARTIST = 2;

/**
 * アーティストページ / デッキと同じ人気度規約。
 * fame_score を主、cert_score をフォールバックに max() で混ぜる。
 */
const popularityScore = (song: Song) =>
  Math.max(song.fame_score ?? 0, song.cert_score ?? 0);

const hasImage = (song: Song) =>
  song.image_url_large != null || song.image_url_medium != null;

/**
 * 音域が入っていない曲はゲストに出さない。ゲストのライブラリは推定音域を
 * ローカル計算するので、音域欠損曲を評価させると「評価したのに音域が
 * 出ない」体験になる。
 */
const hasRange = (song: Song) =>
  song.range_low_midi != null && song.range_high_midi != null;

/** ゲストに出してよい曲か (ジャケット + 音域が揃っているか) */
const isPresentable = (song: Song) => hasImage(song) && hasRange(song);

/** デッキと同じ並び (is_popular → 人気度 → spotify_popularity) */
function byPopularity(a: Song, b: Song) {
  return (
    Number(b.is_popular) - Number(a.is_popular) ||
    popularityScore(b) - popularityScore(a) ||
    (b.spotify_popularity ?? 0) - (a.spotify_popularity ?? 0)
  );
}

type Client = ReturnType<typeof createAdminClient>;

/** アーティスト名 → id。表記ゆれ (=LOVE / ＝LOVE 等) は解決しない */
async function resolveArtistIds(
  supabase: Client,
  names: readonly string[],
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("artists")
    .select("id, name")
    .in("name", [...names]);
  if (error) throw error;

  const byName = new Map<string, string>();
  for (const row of data ?? []) byName.set(row.name, row.id);

  const missing = names.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    throw new Error(
      `artists に見つからないアーティストがあります: ${missing.join(", ")}`,
    );
  }
  return byName;
}

/** 指定アーティストの代表曲を知名度順に取る */
async function fetchArtistTopSongs(
  supabase: Client,
  artistId: string,
  limit: number,
): Promise<Song[]> {
  const { data, error } = await supabase
    .from("songs")
    .select("*")
    .eq("artist_id", artistId)
    .order("is_popular", { ascending: false })
    .order("fame_score", { ascending: false, nullsFirst: false })
    .order("cert_score", { ascending: false, nullsFirst: false })
    .limit(80);
  if (error) throw error;
  return ((data ?? []) as Song[])
    .filter(isPresentable)
    .sort(byPopularity)
    .slice(0, limit);
}

/**
 * ジャンルで曲を集める。songs.genres が空なら artists.genres を継承する
 * (user_genre_distribution / get_unrated_songs_v2 と同じ規約)。曲側 genres
 * だけでは取りこぼすので、アーティスト側からも引いてマージする。
 */
async function fetchByGenre(
  supabase: Client,
  genre: string,
  limit: number,
): Promise<Song[]> {
  const [bySong, artistsRes] = await Promise.all([
    supabase
      .from("songs")
      .select("*")
      .contains("genres", [genre])
      .order("is_popular", { ascending: false })
      .order("fame_score", { ascending: false, nullsFirst: false })
      .order("cert_score", { ascending: false, nullsFirst: false })
      .limit(limit),
    supabase.from("artists").select("id").contains("genres", [genre]).limit(500),
  ]);
  if (bySong.error) throw bySong.error;
  if (artistsRes.error) throw artistsRes.error;

  const artistIds = (artistsRes.data ?? []).map((a) => a.id);
  const chunks: string[][] = [];
  for (let i = 0; i < artistIds.length; i += 100) {
    chunks.push(artistIds.slice(i, i + 100));
  }
  const results = await Promise.all(
    chunks.map((chunk) =>
      supabase
        .from("songs")
        .select("*")
        .in("artist_id", chunk)
        .order("is_popular", { ascending: false })
        .order("fame_score", { ascending: false, nullsFirst: false })
        .limit(limit),
    ),
  );

  let byArtist: Song[] = [];
  for (const r of results) {
    if (r.error) throw r.error;
    byArtist = byArtist.concat((r.data ?? []) as Song[]);
  }

  const seen = new Set<string>();
  const merged: Song[] = [];
  for (const song of [...((bySong.data ?? []) as Song[]), ...byArtist]) {
    // 継承は「曲側 genres が空のときだけ」。曲側が別ジャンルで上書き
    // されているならアーティストのジャンルは当てない。
    const effective =
      song.genres && song.genres.length > 0 ? song.genres : [genre];
    if (!effective.includes(genre)) continue;
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    merged.push(song);
  }
  return merged.filter(isPresentable).sort(byPopularity);
}

/**
 * ゲストのジャンル分布はクライアントで集計するため、artists からの継承を
 * ここで解決して曲に焼き込む (ゲストは artists を読めない)。
 */
async function resolveEffectiveGenres(
  supabase: Client,
  songs: Song[],
): Promise<Map<string, string[]>> {
  const needArtist = songs.filter(
    (s) => (s.genres == null || s.genres.length === 0) && s.artist_id != null,
  );
  const artistIds = [...new Set(needArtist.map((s) => s.artist_id!))];

  const artistGenres = new Map<string, string[]>();
  for (let i = 0; i < artistIds.length; i += 100) {
    const { data, error } = await supabase
      .from("artists")
      .select("id, genres")
      .in("id", artistIds.slice(i, i + 100));
    if (error) throw error;
    for (const row of data ?? []) artistGenres.set(row.id, row.genres ?? []);
  }

  const result = new Map<string, string[]>();
  for (const song of songs) {
    if (song.genres && song.genres.length > 0) {
      result.set(song.id, song.genres);
    } else if (song.artist_id) {
      result.set(song.id, artistGenres.get(song.artist_id) ?? []);
    } else {
      result.set(song.id, []);
    }
  }
  return result;
}

async function main() {
  const printOnly = process.argv.includes("--print");
  const supabase = createAdminClient();

  // --- デッキ 10 組 x 5 曲 -----------------------------------------------
  const artistIds = await resolveArtistIds(supabase, DECK_ARTIST_NAMES);
  const deck: Array<{ artist: string; songs: Song[] }> = [];

  for (const name of DECK_ARTIST_NAMES) {
    const songs = await fetchArtistTopSongs(
      supabase,
      artistIds.get(name)!,
      SONGS_PER_ARTIST,
    );
    if (songs.length < SONGS_PER_ARTIST) {
      throw new Error(
        `${name} の掲載可能な曲が ${songs.length} 曲しかありません ` +
          `(ジャケット + 音域が揃った曲が ${SONGS_PER_ARTIST} 曲必要)`,
      );
    }
    deck.push({ artist: name, songs });
  }

  const deckSongIds = new Set(deck.flatMap((g) => g.songs.map((s) => s.id)));

  // --- 追加 20 曲 --------------------------------------------------------
  const extra: Array<{ genre: string; songs: Song[] }> = [];
  // ジャンルを跨いで同じ曲を二度出さない (「君の知らない物語」は anison と
  // vocaloid_utaite の両方に属する、といった重複が実際にある)
  const takenExtraIds = new Set<string>();

  for (const { genre, count } of EXTRA_GENRES) {
    const pool = await fetchByGenre(supabase, genre, 400);
    const perArtist = new Map<string, number>();
    const picked: Song[] = [];
    for (const song of pool) {
      if (picked.length >= count) break;
      if (deckSongIds.has(song.id) || takenExtraIds.has(song.id)) continue;
      const key = song.artist_id ?? song.artist;
      const used = perArtist.get(key) ?? 0;
      if (used >= EXTRA_MAX_PER_ARTIST) continue;
      perArtist.set(key, used + 1);
      takenExtraIds.add(song.id);
      picked.push(song);
    }
    if (picked.length < count) {
      throw new Error(`${genre} の候補が ${picked.length} 曲しかありません`);
    }
    extra.push({ genre, songs: picked });
  }

  // --- 出力 --------------------------------------------------------------
  const fmt = (s: Song) =>
    `${s.title} / ${s.artist} (${s.release_year ?? "----"}) ` +
    `fame=${s.fame_score ?? "-"} cert=${s.cert_score ?? "-"} ` +
    `range=${s.range_low_midi}-${s.range_high_midi}`;

  console.log(`# デッキ (${deck.length} 組 x ${SONGS_PER_ARTIST} 曲)`);
  deck.forEach((group, i) => {
    console.log(`\n${i + 1}. ${group.artist}`);
    group.songs.forEach((s) => console.log(`   - ${fmt(s)}`));
  });
  console.log(`\n# 追加枠 (${extra.reduce((n, e) => n + e.songs.length, 0)} 曲)`);
  for (const { genre, songs } of extra) {
    console.log(`\n[${genre}]`);
    songs.forEach((s) => console.log(`   - ${fmt(s)}`));
  }

  if (printOnly) return;

  const allSongs = [
    ...deck.flatMap((g) => g.songs),
    ...extra.flatMap((e) => e.songs),
  ];
  const effectiveGenres = await resolveEffectiveGenres(supabase, allSongs);

  const outDir = path.join(process.cwd(), "src/data");
  const outPath = path.join(outDir, "guest-songs.json");
  await mkdir(outDir, { recursive: true });
  // 列は GUEST_SONG_COLUMNS に絞る。全列だと source_urls などスクレイパの
  // 内部管理列でファイルが 3 倍近くになる (ゲストのページはこの JSON を
  // props で丸ごと配るので、そのまま転送量に効く)。
  const trim = (song: Song) => {
    const record: Record<string, unknown> = {};
    for (const column of GUEST_SONG_COLUMNS) record[column] = song[column];
    record.effective_genres = effectiveGenres.get(song.id) ?? [];
    return record;
  };

  await writeFile(
    outPath,
    // 人が読むものではないので minify する (差分は再生成前提でレビューしない)
    JSON.stringify({
      // 再生成した日付。JSON が古いかどうかの判断にだけ使う。
      generatedAt: new Date().toISOString().slice(0, 10),
      songs: allSongs.map(trim),
      // デッキの組 (アーティストごとの song_id 列)。表示順を保持する。
      deck: deck.map((g) => g.songs.map((s) => s.id)),
    }) + "\n",
    "utf8",
  );
  console.log(`\nwrote ${outPath} (${allSongs.length} 曲)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

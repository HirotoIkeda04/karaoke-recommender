import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { RecordDeck } from "./record-deck";

export const dynamic = "force-dynamic";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 1 デッキに積む組 (アーティスト) の数 */
const GROUP_COUNT = 5;
/** 組ごとの曲数 (先頭の推薦シード + 未評価の人気順フォロワー) */
const GROUP_SIZE = 5;
/** フォロワー候補としてアーティストごとに取得する曲数 (評価済み除外前) */
const CANDIDATES_PER_ARTIST = 40;

/**
 * アーティストページと同じ人気度規約: fame_score を主、cert_score を
 * フォールバックに max() で混ぜる (fame 未計算の認定曲を救う)。
 */
const popularityScore = (song: Song) =>
  Math.max(song.fame_score ?? 0, song.cert_score ?? 0);

/**
 * 自分の評価済み (skip 含む) song_id を全件取得する。
 * Supabase は 1 リクエスト最大 1000 行なのでページ送りで集める。
 */
async function fetchEvaluatedSongIds(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // ORDER BY 無しの offset ページングは頁間で並びが揺れて取りこぼすため、
    // PK 内で全順序になる song_id で安定化する。
    const { data, error } = await supabase
      .from("evaluations")
      .select("song_id")
      .eq("user_id", userId)
      .order("song_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      // 黙って「空集合」扱いにすると評価済み曲が未評価として再登場してしまう
      throw new Error(`評価済み一覧の取得に失敗しました: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const row of data) ids.add(row.song_id);
    if (data.length < PAGE) break;
  }
  return ids;
}

export default async function HomePage() {
  const supabase = await createClient();

  // 組のシード曲 (各組の 1 曲目) は従来の推薦 RPC をそのまま使う:
  // ジャンル嗜好 × アーティストブースト × 知名度 × 年代バケットの
  // 重み付きサンプリング。評価済み/スキップ済みは RPC 側で除外される。
  // 020 までの get_unrated_songs では PostgREST 接続プールが旧プランを
  // キャッシュし続けた問題があり、_v2 に別名で作り直した経緯がある。
  const [unratedRes, authRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)("get_unrated_songs_v2", {
      p_limit: 20,
      p_popular_only: true,
      p_require_image: true,
    }),
    supabase.auth.getUser(),
  ]);
  const { data, error } = unratedRes;

  if (error) {
    return (
      <div className="mx-auto max-w-md p-6">
        <h1 className="text-lg font-semibold text-red-600">読み込みエラー</h1>
        <pre className="mt-4 rounded bg-red-50 p-3 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          {error.message}
        </pre>
      </div>
    );
  }

  const seeds = (data ?? []) as Song[];

  if (seeds.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">代表曲をすべて評価しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          検索ページから他の曲も評価できます。
        </p>
        <Link href="/songs" className={buttonVariants({ size: "lg" })}>
          楽曲を検索する
        </Link>
      </div>
    );
  }

  // シードをアーティストで dedupe し、先頭 GROUP_COUNT 組の 1 曲目にする。
  const seedByArtist = new Map<string, Song>();
  const artistlessSeeds: Song[] = [];
  for (const seed of seeds) {
    if (!seed.artist_id) {
      artistlessSeeds.push(seed);
      continue;
    }
    if (seedByArtist.size < GROUP_COUNT && !seedByArtist.has(seed.artist_id)) {
      seedByArtist.set(seed.artist_id, seed);
    }
  }
  const artistIds = [...seedByArtist.keys()];
  if (authRes.error) {
    // user=null に落として評価済み除外を空にすると評価済み曲が再登場するので、
    // 認証情報の取得失敗は明示的にエラーにする (セッション自体は layout が保証)。
    throw new Error(`ユーザー情報の取得に失敗しました: ${authRes.error.message}`);
  }
  const user = authRes.data.user;

  // 並行取得: 各アーティストの人気曲候補 (画像必須) + 自分の評価済み集合。
  // PostgREST は NOT EXISTS を書けないので評価済み除外は TS 側で行う
  // (アーティストページと同じパターン)。
  const [candidateLists, evaluatedIds] = await Promise.all([
    Promise.all(
      artistIds.map((artistId) =>
        // DB 側の窓 (limit) を TS 側の popularityScore ランキングと同じ複合キーで
        // 切る。fame_score 単キーだと多作アーティストで is_popular / 認定曲が
        // 窓の外に落ちる。
        supabase
          .from("songs")
          .select("*")
          .eq("artist_id", artistId)
          .or("image_url_large.not.is.null,image_url_medium.not.is.null")
          .order("is_popular", { ascending: false })
          .order("fame_score", { ascending: false, nullsFirst: false })
          .order("cert_score", { ascending: false, nullsFirst: false })
          .order("spotify_popularity", { ascending: false, nullsFirst: false })
          .limit(CANDIDATES_PER_ARTIST),
      ),
    ),
    user
      ? fetchEvaluatedSongIds(supabase, user.id)
      : Promise.resolve(new Set<string>()),
  ]);

  const groups: Song[][] = artistIds.map((artistId, i) => {
    const seed = seedByArtist.get(artistId)!;
    if (candidateLists[i].error) {
      // フォロワー取得失敗はシード 1 曲の組に劣化させる (デッキ全体は止めない)
      console.error(
        `アーティスト ${artistId} の候補曲取得に失敗:`,
        candidateLists[i].error,
      );
    }
    const followers = ((candidateLists[i].data ?? []) as Song[])
      .filter((song) => song.id !== seed.id && !evaluatedIds.has(song.id))
      .sort(
        (a, b) =>
          Number(b.is_popular) - Number(a.is_popular) ||
          popularityScore(b) - popularityScore(a) ||
          (b.spotify_popularity ?? 0) - (a.spotify_popularity ?? 0),
      )
      .slice(0, GROUP_SIZE - 1);
    return [seed, ...followers];
  });

  // artist_id の無いシードは 1 曲だけの組として補充し、組数を保つ。
  for (const seed of artistlessSeeds) {
    if (groups.length >= GROUP_COUNT) break;
    groups.push([seed]);
  }

  return <RecordDeck initialGroups={groups} />;
}

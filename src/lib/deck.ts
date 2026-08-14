import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** 1 デッキに積む組 (アーティスト) の数 */
const GROUP_COUNT = 7;
/** 組ごとの曲数 (先頭の推薦シード + 未評価の人気順フォロワー) */
const GROUP_SIZE = 5;
/** フォロワー候補としてアーティストごとに取得する曲数 (評価済み除外前) */
const CANDIDATES_PER_ARTIST = 40;

/** デッキのシード曲を保存する cookie 名 */
export const DECK_COOKIE = "deck_seeds";

/**
 * デッキの寿命。これを過ぎたら次に開いた時に新しいデッキを組み直す。
 * タブ切替やアーティストページ往復で推薦が入れ替わらないようにするのが
 * 目的なので、体感で「同じセッション中は変わらない」長さにしてある。
 */
export const DECK_TTL_MS = 6 * 60 * 60 * 1000;

export const DECK_COOKIE_OPTIONS = {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  maxAge: Math.floor(DECK_TTL_MS / 1000),
} as const;

/**
 * cookie の値 = `<発行時刻(ms)>.<シード song_id>...`。
 * 曲そのものではなくシードの id 列だけを持ち、組の中身 (同一アーティストの
 * 人気曲) は毎回 DB から組み直す = 評価済みの曲は自然に落ちる。
 */
const DECK_TOKEN_RE =
  /^\d{13}(?:\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}){1,16}$/;

export function isDeckToken(value: string): boolean {
  return DECK_TOKEN_RE.test(value);
}

function encodeDeckToken(issuedAt: number, seedIds: string[]): string {
  return [issuedAt, ...seedIds].join(".");
}

/** cookie 値を検証しつつ復元する。壊れた値・期限切れは null (= 組み直し) */
function parseDeckToken(
  value: string | null,
  now: number,
): { issuedAt: number; seedIds: string[] } | null {
  if (!value || !isDeckToken(value)) return null;
  const [head, ...seedIds] = value.split(".");
  const issuedAt = Number(head);
  // 未来の発行時刻 (端末時計のずれ・改竄) は信用しない
  if (issuedAt > now || now - issuedAt >= DECK_TTL_MS) return null;
  return { issuedAt, seedIds: seedIds.slice(0, GROUP_COUNT) };
}

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

/** 保存済みシードを id 指定で復元する (cookie の並び順を維持する) */
async function fetchSeedSongs(
  supabase: SupabaseServerClient,
  seedIds: string[],
): Promise<Song[]> {
  const { data, error } = await supabase
    .from("songs")
    .select("*")
    .in("id", seedIds);
  if (error) {
    // 復元に失敗しただけならデッキは組み直せるので、止めずに空で続行する
    console.error("保存済みデッキの復元に失敗:", error);
    return [];
  }
  const byId = new Map((data as Song[]).map((song) => [song.id, song]));
  return seedIds
    .map((id) => byId.get(id))
    .filter((song): song is Song => song != null);
}

export interface Deck {
  /** 組 (同一アーティストの楽曲群) の配列。各組は [推薦シード, ...人気順] */
  groups: Song[][];
  /**
   * cookie に保存すべき値。現在の cookie と同じ内容なら null。
   * Server Component からは cookie を書けないので、クライアント側から
   * persistDeck アクション経由で保存する。
   */
  persistToken: string | null;
  /** 1 組も組めなかった時の原因 (推薦 RPC のエラー) */
  error?: string;
}

/**
 * ホームのレコードデッキを組む。
 *
 * deckCookie に有効なシードが入っていればそれを再利用し、足りない分
 * (期限切れ・評価済みで落ちた分・cookie 無し) だけ推薦 RPC で補充する。
 * これによりタブ切替やアーティストページ往復では推薦が入れ替わらず、
 * 入れ替わるのは「シャッフル (deckCookie = null)」「TTL 経過」
 * 「その組を評価し切った」時だけになる。
 */
export async function buildDeck(
  supabase: SupabaseServerClient,
  deckCookie: string | null,
): Promise<Deck> {
  const now = Date.now();
  const saved = parseDeckToken(deckCookie, now);

  // 保存済みシードの取得はユーザー情報 / 評価済み一覧と並行して走らせる
  const savedSongsPromise = saved
    ? fetchSeedSongs(supabase, saved.seedIds)
    : Promise.resolve<Song[]>([]);

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) {
    // user=null に落として評価済み除外を空にすると評価済み曲が再登場するので、
    // 認証情報の取得失敗は明示的にエラーにする (セッション自体は layout が保証)。
    throw new Error(`ユーザー情報の取得に失敗しました: ${authError.message}`);
  }
  const user = authData.user;

  const [savedSongs, evaluatedIds] = await Promise.all([
    savedSongsPromise,
    user
      ? fetchEvaluatedSongIds(supabase, user.id)
      : Promise.resolve(new Set<string>()),
  ]);

  // シードはアーティスト単位で dedupe する (同じ組が二重に並ばないように)。
  // artist_id を持たない曲は組を作れないので 1 曲だけの組になる。
  const seeds: Song[] = [];
  const usedArtistIds = new Set<string>();
  const pushSeed = (song: Song) => {
    if (seeds.length >= GROUP_COUNT) return;
    if (evaluatedIds.has(song.id)) return;
    if (song.artist_id) {
      if (usedArtistIds.has(song.artist_id)) return;
      usedArtistIds.add(song.artist_id);
    }
    seeds.push(song);
  };

  for (const song of savedSongs) pushSeed(song);

  let rpcError: string | undefined;
  if (seeds.length < GROUP_COUNT) {
    // 不足分の補充は従来の推薦 RPC: ジャンル嗜好 × アーティストブースト ×
    // 知名度 × 年代バケットの重み付きサンプリング。評価済み/スキップ済みは
    // RPC 側で除外される。020 までの get_unrated_songs では PostgREST 接続
    // プールが旧プランをキャッシュし続けた問題があり、_v2 に別名で作り直した。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)(
      "get_unrated_songs_v2",
      { p_limit: 20, p_popular_only: true, p_require_image: true },
    );
    if (error) rpcError = error.message;
    for (const song of (data ?? []) as Song[]) pushSeed(song);
  }

  if (seeds.length === 0) {
    return { groups: [], persistToken: null, error: rpcError };
  }

  // 各アーティストの人気曲候補 (画像必須) を並行取得する。
  // PostgREST は NOT EXISTS を書けないので評価済み除外は TS 側で行う
  // (アーティストページと同じパターン)。
  const candidateLists = await Promise.all(
    seeds.map((seed) =>
      seed.artist_id
        ? // DB 側の窓 (limit) を TS 側の popularityScore ランキングと同じ複合キーで
          // 切る。fame_score 単キーだと多作アーティストで is_popular / 認定曲が
          // 窓の外に落ちる。
          supabase
            .from("songs")
            .select("*")
            .eq("artist_id", seed.artist_id)
            .or("image_url_large.not.is.null,image_url_medium.not.is.null")
            .order("is_popular", { ascending: false })
            .order("fame_score", { ascending: false, nullsFirst: false })
            .order("cert_score", { ascending: false, nullsFirst: false })
            .order("spotify_popularity", { ascending: false, nullsFirst: false })
            .limit(CANDIDATES_PER_ARTIST)
        : null,
    ),
  );

  const groups: Song[][] = seeds.map((seed, i) => {
    const result = candidateLists[i];
    if (result?.error) {
      // フォロワー取得失敗はシード 1 曲の組に劣化させる (デッキ全体は止めない)
      console.error(
        `アーティスト ${seed.artist_id} の候補曲取得に失敗:`,
        result.error,
      );
    }
    const followers = ((result?.data ?? []) as Song[])
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

  // 補充しても TTL の起点は動かさない (延々と延命されないように)
  const token = encodeDeckToken(
    saved?.issuedAt ?? now,
    seeds.map((seed) => seed.id),
  );
  return {
    groups,
    persistToken: token === deckCookie ? null : token,
  };
}

/**
 * 未ログイン (ゲスト) の評価を localStorage に保持する。
 *
 * ゲストは evaluations テーブルに書けない (RLS で自分の user_id が必要) ので、
 * 評価・スキップ・取り消しはすべてここへ。ログインしたら
 * importGuestRatings (src/app/(app)/guest-actions.ts) が DB へ移して空にする。
 *
 * 対象はゲスト公開の 70 曲だけなので件数は高々 70 件。容量や整合性の心配は
 * ないが、ブラウザのストレージ削除で消える (iOS Safari は 7 日間未使用で
 * スクリプト由来のストレージを破棄することがある)。だからライブラリに
 * 「ログインしないと履歴が残りません」と出す必要がある。
 */
import type { Database } from "@/types/database";

export type Rating = Database["public"]["Enums"]["rating_type"];

const STORAGE_KEY = "kyokumoku.guest.ratings.v1";

/** 同一タブ内での変更を各コンポーネントへ伝えるイベント */
const CHANGE_EVENT = "kyokumoku:guest-ratings-change";

export interface GuestRating {
  rating: Rating;
  /** ISO 8601。DB へ移す時の updated_at と、ライブラリの並び順に使う */
  updatedAt: string;
}

/** song_id -> 評価 */
export type GuestRatingMap = Record<string, GuestRating>;

const RATINGS: ReadonlySet<string> = new Set([
  "easy",
  "medium",
  "hard",
  "practicing",
  "skip",
]);

const EMPTY: GuestRatingMap = Object.freeze({});

function isRating(value: unknown): value is Rating {
  return typeof value === "string" && RATINGS.has(value);
}

/**
 * 壊れた値はサイレントに捨てる。ゲストの評価は「消えても致命傷ではない」
 * データなので、読めない時に例外を投げてページごと落とす方が損。
 */
export function readGuestRatings(): GuestRatingMap {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari のプライベートブラウズなど、localStorage 自体が使えない環境
    return EMPTY;
  }
  if (!raw) return EMPTY;

  try {
    const parsed = JSON.parse(raw) as { ratings?: unknown };
    const ratings = parsed?.ratings;
    if (typeof ratings !== "object" || ratings === null) return EMPTY;

    const result: GuestRatingMap = {};
    for (const [songId, value] of Object.entries(
      ratings as Record<string, unknown>,
    )) {
      const entry = value as { rating?: unknown; updatedAt?: unknown };
      if (!isRating(entry?.rating)) continue;
      result[songId] = {
        rating: entry.rating,
        updatedAt:
          typeof entry.updatedAt === "string"
            ? entry.updatedAt
            : new Date(0).toISOString(),
      };
    }
    return result;
  } catch {
    return EMPTY;
  }
}

function write(ratings: GuestRatingMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, ratings }),
    );
  } catch {
    // 容量超過や書き込み不可でも操作自体は続行させる (次の読み出しで
    // 古い値が返るだけ)。
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function setGuestRating(songId: string, rating: Rating): void {
  const next = { ...readGuestRatings() };
  next[songId] = { rating, updatedAt: new Date().toISOString() };
  write(next);
}

export function removeGuestRating(songId: string): void {
  const next = { ...readGuestRatings() };
  if (!(songId in next)) return;
  delete next[songId];
  write(next);
}

export function clearGuestRatings(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// useSyncExternalStore は「変わっていなければ同じ参照」を返すことを要求する
// (毎回新しいオブジェクトを返すと再レンダーが止まらない)。生の文字列が
// 同じ間はパース済みの map を使い回す。
let cachedRaw: string | null = null;
let cachedMap: GuestRatingMap = EMPTY;

/** useSyncExternalStore 用のスナップショット (参照が安定する) */
export function getGuestRatingsSnapshot(): GuestRatingMap {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedMap = readGuestRatings();
  }
  return cachedMap;
}

/** 変更 (同一タブ + 別タブ) を購読する。useSyncExternalStore 用 */
export function subscribeGuestRatings(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === STORAGE_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** サーバーレンダー時のスナップショット (localStorage が無いので常に空) */
export function getServerGuestRatings(): GuestRatingMap {
  return EMPTY;
}

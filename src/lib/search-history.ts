// 検索タブの「最近」リスト (Spotify 風) の localStorage 永続化。
// クエリ文字列ではなく、タップした曲/アーティスト単位で保存する。

const STORAGE_KEY = "karaokeapp:search-history:v1";
const MAX_ITEMS = 20;

export interface RecentSong {
  type: "song";
  id: string;
  title: string;
  artist: string;
  image: string | null;
  addedAt: number;
}

export interface RecentArtist {
  type: "artist";
  id: string;
  name: string;
  image: string | null;
  addedAt: number;
}

export type RecentItem = RecentSong | RecentArtist;

export type RecentItemInput =
  | Omit<RecentSong, "addedAt">
  | Omit<RecentArtist, "addedAt">;

function isRecentItem(v: unknown): v is RecentItem {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.type === "song") {
    return (
      typeof o.id === "string" &&
      typeof o.title === "string" &&
      typeof o.artist === "string" &&
      typeof o.addedAt === "number"
    );
  }
  if (o.type === "artist") {
    return (
      typeof o.id === "string" &&
      typeof o.name === "string" &&
      typeof o.addedAt === "number"
    );
  }
  return false;
}

export function loadHistory(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentItem);
  } catch {
    return [];
  }
}

function saveHistory(items: RecentItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // quota / privacy mode 等は黙殺
  }
}

/** 同じ id+type は最新のものに上書きして先頭に持ってくる */
export function pushHistory(item: RecentItemInput): RecentItem[] {
  const now = Date.now();
  const next = { ...item, addedAt: now } as RecentItem;
  const prev = loadHistory().filter(
    (h) => !(h.type === item.type && h.id === item.id),
  );
  const merged = [next, ...prev].slice(0, MAX_ITEMS);
  saveHistory(merged);
  return merged;
}

export function removeHistoryItem(
  type: RecentItem["type"],
  id: string,
): RecentItem[] {
  const next = loadHistory().filter((h) => !(h.type === type && h.id === id));
  saveHistory(next);
  return next;
}

export function clearHistory(): void {
  saveHistory([]);
}

"use client";

import { Search, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SongCard } from "@/components/song-card";
import { GENRE_CODES, GENRE_LABELS, type GenreCode } from "@/lib/genres";
import { karaokeToMidi } from "@/lib/note";
import {
  loadHistory,
  pushHistory,
  type RecentItem,
  removeHistoryItem,
} from "@/lib/search-history";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

type Song = Pick<
  Database["public"]["Tables"]["songs"]["Row"],
  | "id"
  | "title"
  | "artist"
  | "release_year"
  | "range_low_midi"
  | "range_high_midi"
  | "falsetto_max_midi"
  | "image_url_small"
  | "image_url_medium"
>;

interface ArtistResult {
  id: string;
  name: string;
  genres: string[] | null;
  song_count: number | null;
  image_url: string | null;
}

interface SearchResponse {
  artists: ArtistResult[];
  songs: Song[];
}

interface LiveSearchProps {
  /** key: song_id, value: rating */
  ratings: Record<string, string>;
  /** Spotify で聴いたことがある song_id 一覧 */
  knownSongIds?: string[];
}

const HIGH_OPTIONS = [
  "",
  "mid2C",
  "mid2E",
  "mid2G",
  "hiA",
  "hiC",
  "hiD",
  "hiE",
  "hiF",
];

// 各ジャンルの背景グラデーション (Spotify 風カラフル系)
const GENRE_GRADIENTS: Record<GenreCode, string> = {
  j_pop: "from-pink-500 to-rose-700",
  j_rock: "from-orange-500 to-red-700",
  anison: "from-sky-500 to-indigo-700",
  vocaloid_utaite: "from-cyan-400 to-teal-700",
  idol_female: "from-fuchsia-400 to-pink-700",
  idol_male: "from-blue-500 to-indigo-800",
  rnb_soul: "from-amber-600 to-yellow-800",
  hiphop: "from-zinc-700 to-zinc-900",
  enka_kayo: "from-red-700 to-rose-900",
  western: "from-emerald-500 to-green-800",
  kpop: "from-purple-500 to-violet-800",
  game_bgm: "from-lime-500 to-emerald-700",
  other: "from-slate-500 to-slate-700",
};

const DEBOUNCE_MS = 200;

export function LiveSearch({ ratings, knownSongIds = [] }: LiveSearchProps) {
  const [query, setQuery] = useState("");
  const [highMax, setHighMax] = useState("");
  const [highMin, setHighMin] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [history, setHistory] = useState<RecentItem[]>([]);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);

  // 初期マウント時に履歴を読み込む (SSR では window 不在)
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // BottomNav の検索タブ再タップで input にフォーカス + 履歴表示
  useEffect(() => {
    const handler = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      // モバイルで仮想キーボード表示を促すため select() で再フォーカス感を出す
      try {
        el.select();
      } catch {
        // 一部ブラウザでは search input に select 不可 — 黙殺
      }
    };
    window.addEventListener("app:focus-search", handler);
    return () => window.removeEventListener("app:focus-search", handler);
  }, []);

  const trimmedQ = query.trim();

  // サーバー検索 (debounce + AbortController で多重発火を抑制)
  useEffect(() => {
    if (trimmedQ.length === 0) {
      setResults(null);
      setLoading(false);
      setErrMsg(null);
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setErrMsg(null);
      const highMinMidi = highMin ? karaokeToMidi(highMin) : null;
      const highMaxMidi = highMax ? karaokeToMidi(highMax) : null;
      const { data, error } = await supabase
        .rpc("search_songs_and_artists", {
          p_q: trimmedQ,
          p_high_min_midi: highMinMidi,
          p_high_max_midi: highMaxMidi,
        })
        .abortSignal(ctrl.signal);
      if (ctrl.signal.aborted) return;
      if (error) {
        setErrMsg(error.message);
        setResults({ artists: [], songs: [] });
      } else {
        // RPC は jsonb を返すので shape を信じてキャスト
        setResults((data ?? { artists: [], songs: [] }) as unknown as SearchResponse);
      }
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [trimmedQ, highMin, highMax, supabase]);

  // モード判定: 入力あり=results / フォーカス中=history / それ以外=browse
  const mode: "browse" | "history" | "results" =
    trimmedQ.length > 0 ? "results" : isFocused ? "history" : "browse";

  const handleClear = useCallback(() => {
    setQuery("");
    inputRef.current?.focus();
  }, []);

  const handleSelectSong = useCallback((s: Song) => {
    const next = pushHistory({
      type: "song",
      id: s.id,
      title: s.title,
      artist: s.artist,
      image: s.image_url_small ?? s.image_url_medium ?? null,
    });
    setHistory(next);
  }, []);

  const handleSelectArtist = useCallback((a: ArtistResult) => {
    const next = pushHistory({
      type: "artist",
      id: a.id,
      name: a.name,
      image: a.image_url,
    });
    setHistory(next);
  }, []);

  const handleRemoveHistory = useCallback(
    (e: React.MouseEvent, type: RecentItem["type"], id: string) => {
      e.preventDefault();
      e.stopPropagation();
      setHistory(removeHistoryItem(type, id));
    },
    [],
  );

  return (
    <div className="space-y-4">
      {/* 検索バー本体: 右側に検索アイコン or クリアボタン */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500 dark:text-zinc-400"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder="楽曲・アーティストを検索"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          // search 型ネイティブの clear ボタンは UI が分散するので非表示
          className="w-full rounded-lg bg-zinc-100 py-2 pl-9 pr-9 text-sm placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800 dark:placeholder:text-zinc-400 [&::-webkit-search-cancel-button]:hidden"
        />
        {query.length > 0 ? (
          <button
            type="button"
            onClick={handleClear}
            // mousedown で input から blur する前にクリックを処理
            onMouseDown={(e) => e.preventDefault()}
            aria-label="検索文字列をクリア"
            className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/* 高音域フィルタ: results / history どちらの状態でも有効 (browse 時は隠す) */}
      {mode !== "browse" ? (
        <div className="flex items-center gap-2 text-sm">
          <select
            value={highMin}
            onChange={(e) => setHighMin(e.target.value)}
            aria-label="最高音の下限"
            className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800"
          >
            {HIGH_OPTIONS.map((v) => (
              <option key={`min-${v}`} value={v}>
                {v || "—"}
              </option>
            ))}
          </select>
          <span className="shrink-0 whitespace-nowrap text-xs text-zinc-500 dark:text-zinc-400">
            ≤ 最高音 ≤
          </span>
          <select
            value={highMax}
            onChange={(e) => setHighMax(e.target.value)}
            aria-label="最高音の上限"
            className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-pink-500 dark:bg-zinc-800"
          >
            {HIGH_OPTIONS.map((v) => (
              <option key={`max-${v}`} value={v}>
                {v || "—"}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {mode === "browse" ? (
        <BrowseGrid />
      ) : mode === "history" ? (
        <HistoryList
          history={history}
          onRemove={handleRemoveHistory}
          onSelectSong={(s) => handleSelectSong(s)}
          onSelectArtist={(a) => handleSelectArtist(a)}
          ratings={ratings}
          knownSet={knownSet}
        />
      ) : (
        <ResultsList
          loading={loading}
          errMsg={errMsg}
          results={results}
          ratings={ratings}
          knownSet={knownSet}
          onSelectSong={handleSelectSong}
          onSelectArtist={handleSelectArtist}
        />
      )}
    </div>
  );
}

// ============================================================================
// Browse: ジャンルカードグリッド
// ============================================================================
// Step 2 で /songs/genre/[code] へリンクさせる予定。今は視覚的なプレースホルダ。
function BrowseGrid() {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        ブラウズを開始
      </h2>
      <ul className="grid grid-cols-2 gap-2">
        {GENRE_CODES.map((code) => (
          <li key={code}>
            <div
              className={`relative flex aspect-[16/10] items-start overflow-hidden rounded-lg bg-gradient-to-br ${GENRE_GRADIENTS[code]} p-3 opacity-90`}
              aria-label={`${GENRE_LABELS[code]} (準備中)`}
            >
              <span className="text-sm font-bold leading-tight text-white drop-shadow">
                {GENRE_LABELS[code]}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================================
// History: タップした曲/アーティストの最近リスト (Spotify 風)
// ============================================================================
function HistoryList({
  history,
  onRemove,
  onSelectSong,
  onSelectArtist,
  ratings,
  knownSet,
}: {
  history: RecentItem[];
  onRemove: (
    e: React.MouseEvent,
    type: RecentItem["type"],
    id: string,
  ) => void;
  onSelectSong: (s: Song) => void;
  onSelectArtist: (a: ArtistResult) => void;
  ratings: Record<string, string>;
  knownSet: Set<string>;
}) {
  if (history.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        最近の検索はまだありません
      </p>
    );
  }
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        最近
      </h2>
      <ul>
        {history.map((item) => (
          <li
            key={`${item.type}:${item.id}`}
            className="flex items-center gap-1"
          >
            <div className="min-w-0 flex-1">
              {item.type === "song" ? (
                <SongCard
                  song={{
                    id: item.id,
                    title: item.title,
                    artist: item.artist,
                    release_year: null,
                    range_low_midi: null,
                    range_high_midi: null,
                    falsetto_max_midi: null,
                    image_url_small: item.image,
                    image_url_medium: null,
                  }}
                  rating={ratings[item.id] ?? null}
                  isKnown={knownSet.has(item.id)}
                />
              ) : (
                <ArtistRow
                  artist={{
                    id: item.id,
                    name: item.name,
                    genres: null,
                    song_count: null,
                    image_url: item.image,
                  }}
                  onSelect={onSelectArtist}
                />
              )}
            </div>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => onRemove(e, item.type, item.id)}
              aria-label="履歴から削除"
              className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ============================================================================
// Results: アーティスト + 曲セクション
// ============================================================================
function ResultsList({
  loading,
  errMsg,
  results,
  ratings,
  knownSet,
  onSelectSong,
  onSelectArtist,
}: {
  loading: boolean;
  errMsg: string | null;
  results: SearchResponse | null;
  ratings: Record<string, string>;
  knownSet: Set<string>;
  onSelectSong: (s: Song) => void;
  onSelectArtist: (a: ArtistResult) => void;
}) {
  if (errMsg) {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
        {errMsg}
      </div>
    );
  }
  // 初回フェッチ中: 中身が無いのでスケルトン的なテキストのみ
  if (loading && !results) {
    return (
      <p className="px-2 py-4 text-center text-xs text-zinc-500 dark:text-zinc-400">
        検索中…
      </p>
    );
  }
  if (!results) return null;

  const { artists, songs } = results;
  if (artists.length === 0 && songs.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
        該当する結果がありません
      </p>
    );
  }

  return (
    <div className={loading ? "space-y-6 opacity-70" : "space-y-6"}>
      {artists.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            アーティスト
          </h2>
          <ul>
            {artists.map((a) => (
              <li key={a.id}>
                <ArtistRow artist={a} onSelect={onSelectArtist} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {songs.length > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            楽曲
          </h2>
          <ul>
            {songs.map((s) => (
              <li key={s.id} onClickCapture={() => onSelectSong(s)}>
                <SongCard
                  song={s}
                  rating={ratings[s.id] ?? null}
                  isKnown={knownSet.has(s.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ============================================================================
// ArtistRow: アーティスト一覧の 1 行 (SongCard と縦リズムを揃える)
// ============================================================================
function ArtistRow({
  artist,
  onSelect,
}: {
  artist: ArtistResult;
  onSelect: (a: ArtistResult) => void;
}) {
  return (
    <Link
      href={`/artists/${artist.id}`}
      onClick={() => onSelect(artist)}
      className="flex items-center gap-3 rounded-md p-2 transition hover:bg-zinc-100 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800/60"
    >
      <div className="relative size-12 shrink-0 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        {artist.image_url ? (
          <Image
            src={artist.image_url}
            alt=""
            fill
            sizes="3rem"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-base text-zinc-500">
            {artist.name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {artist.name}
        </p>
        <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
          アーティスト
          {artist.song_count != null ? ` · ${artist.song_count} 曲` : ""}
        </p>
      </div>
    </Link>
  );
}

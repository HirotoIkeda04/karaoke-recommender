"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistRow, type ArtistRowData } from "@/components/artist-row";
import { SongCard } from "@/components/song-card";
import { JacketImage } from "@/components/ui/jacket-image";
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

interface ArtistResult extends ArtistRowData {
  genres: string[] | null;
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
  /** ジャンルカード背景に使う、各ジャンル top 4 曲のジャケット URL */
  genreCovers?: Partial<Record<GenreCode, string[]>>;
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

// 各ジャンルカードに被せる暗色グラデーション。
// ジャンル識別性を保ちつつ、カラオケ向けに眩しすぎないよう *-950 系の
// 深い色で from を作り、to は黒に向けて薄れさせてジャケ写を覗かせる。
// 暗くしすぎるとジャケが潰れるので、from/via/to はジャケが透ける程度の
// 中間不透明度に。Tailwind の JIT が拾えるよう必ず完全なクラス名で書く。
const GENRE_OVERLAY: Record<GenreCode, string> = {
  j_pop: "from-pink-950/75 via-rose-950/45 to-black/25",
  j_rock: "from-orange-950/75 via-red-950/45 to-black/25",
  anison: "from-sky-950/75 via-indigo-950/45 to-black/25",
  vocaloid_utaite: "from-cyan-950/75 via-teal-950/45 to-black/25",
  idol_female: "from-fuchsia-950/75 via-pink-950/45 to-black/25",
  idol_male: "from-blue-950/75 via-indigo-950/45 to-black/25",
  rnb_soul: "from-amber-950/75 via-yellow-950/45 to-black/25",
  hiphop: "from-zinc-900/82 via-zinc-950/55 to-black/25",
  enka_kayo: "from-red-950/75 via-rose-950/45 to-black/25",
  western: "from-emerald-950/75 via-green-950/45 to-black/25",
  kpop: "from-purple-950/75 via-violet-950/45 to-black/25",
  game_bgm: "from-lime-950/75 via-emerald-950/45 to-black/25",
  other: "from-slate-900/82 via-slate-950/55 to-black/25",
};

const DEBOUNCE_MS = 200;

export function LiveSearch({
  ratings,
  knownSongIds = [],
  genreCovers = {},
}: LiveSearchProps) {
  const [query, setQuery] = useState("");
  const [highMax, setHighMax] = useState("");
  const [highMin, setHighMin] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [history, setHistory] = useState<RecentItem[]>([]);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimerRef = useRef<number | null>(null);
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

  const handleSelectArtist = useCallback((a: ArtistRowData) => {
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

  // input ↔ filter 間で focus が移動しても browse に戻らないよう
  // 同じスコープ内の onFocus/onBlur で扱う (React の focus は bubble する)。
  // BrowseGrid のジャンル <Link> はこのスコープ外に置くことで、
  // Link が focus を取った瞬間に mode="history" へ遷移して unmount される
  // ことを防ぐ。
  const onFilterFocus = () => {
    if (blurTimerRef.current !== null) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setIsFocused(true);
  };
  const onFilterBlur = () => {
    // 履歴項目タップ時に Link が unmount されないよう mode 切り替えを遅延
    blurTimerRef.current = window.setTimeout(() => {
      setIsFocused(false);
      blurTimerRef.current = null;
    }, 200);
  };

  return (
    <div className="space-y-4">
      <div
        className="space-y-4"
        onFocus={onFilterFocus}
        onBlur={onFilterBlur}
      >
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

      {/* 高音域フィルタ: results / history どちらの状態でも有効。
          値が設定されているときは browse でも表示し続ける (解除導線確保) */}
      {mode !== "browse" || highMin || highMax ? (
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
      </div>

      {mode === "browse" ? (
        <BrowseGrid genreCovers={genreCovers} />
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
//   - 各ジャンルのランキング上位曲 (fame_score 降順) のジャケットを 2x2 モザイク
//     で背景に敷き、暗いグラデーションを重ねてタイトルを白文字で乗せる。
//   - covers が空のジャンルは zinc-900 のフラット背景にフォールバック。
// ============================================================================
function BrowseGrid({
  genreCovers,
}: {
  genreCovers: Partial<Record<GenreCode, string[]>>;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        ブラウズを開始
      </h2>
      <ul className="grid grid-cols-2 gap-2">
        {GENRE_CODES.map((code) => {
          const covers = genreCovers[code] ?? [];
          return (
            <li key={code}>
              <Link
                href={`/songs/genre/${code}`}
                className="relative flex aspect-[16/10] items-start overflow-hidden rounded-lg bg-zinc-900 pl-4 pr-3 pt-4 pb-3 transition active:scale-[0.98]"
              >
                {covers.length > 0 ? (
                  // モザイクは blur をかけずシャープに描画。
                  // 文字可読性のための blur は後段の局所 backdrop-filter で
                  // テキスト直下にのみ適用する (本要素は色情報の供給役)。
                  <div
                    className="absolute inset-0 grid grid-cols-2 grid-rows-2"
                    aria-hidden
                  >
                    {[0, 1, 2, 3].map((i) => {
                      // 4 枚揃わない場合は循環させて隙間を埋める
                      const src = covers[i] ?? covers[i % covers.length];
                      return (
                        <div key={i} className="relative bg-zinc-800">
                          {src ? (
                            <JacketImage
                              src={src}
                              alt=""
                              fill
                              sizes="(max-width: 640px) 25vw, 12vw"
                              className="object-cover"
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {/* ジャンル別の暗色グラデーションで識別性 + 可読性を確保 */}
                <div
                  className={`absolute inset-0 bg-gradient-to-br ${GENRE_OVERLAY[code]}`}
                  aria-hidden
                />
                {/* ガラス風 2px リム: padding=2px で枠の太さを定義し、
                    border-box と content-box の mask を exclude 合成で
                    中央をくり抜く。backdrop-filter は枠部分にのみ効くため、
                    swipe-deck カードと同じ「内側 2px だけガラス」になる。
                    static カードなので clip-path 二重描画は不要。 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-lg"
                  style={{
                    padding: "2px",
                    background: "rgba(255,255,255,0.18)",
                    backdropFilter:
                      "blur(20px) brightness(1.2) saturate(1.4)",
                    WebkitBackdropFilter:
                      "blur(20px) brightness(1.2) saturate(1.4)",
                    WebkitMask:
                      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                    WebkitMaskComposite: "xor",
                    mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                    maskComposite: "exclude",
                  }}
                />
                {/* 文字直下だけに局所 backdrop-blur をかけてジャケの細かい
                    エッジを和らげ、可読性を底上げする (全面 blur は使わない)。
                    背景色は付けず、blur 効果のみで目立たないチップに。 */}
                <span className="relative z-10 inline-block self-start rounded-md px-1.5 py-0.5 backdrop-blur-md">
                  <span className="text-sm font-extrabold leading-tight tracking-tight text-zinc-200 drop-shadow-md">
                    {GENRE_LABELS[code]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
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
  onSelectArtist: (a: ArtistRowData) => void;
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
            <div
              className="min-w-0 flex-1"
              onClickCapture={
                item.type === "song"
                  ? () =>
                      onSelectSong({
                        id: item.id,
                        title: item.title,
                        artist: item.artist,
                        release_year: null,
                        range_low_midi: null,
                        range_high_midi: null,
                        falsetto_max_midi: null,
                        image_url_small: item.image,
                        image_url_medium: null,
                      })
                  : undefined
              }
            >
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
  onSelectArtist: (a: ArtistRowData) => void;
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


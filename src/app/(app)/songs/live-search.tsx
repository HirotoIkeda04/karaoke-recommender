"use client";

import { CalendarRange, Search, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistRow, type ArtistRowData } from "@/components/artist-row";
import { DecadeChips } from "@/components/decade-chips";
import { SongCard } from "@/components/song-card";
import { JacketImage } from "@/components/ui/jacket-image";
import {
  BROWSE_GENRE_CODES,
  GENRE_LABELS,
  type GenreCode,
} from "@/lib/genres";
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
  | "duration_ms"
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
  /** ランキングカード背景に使う、今週 top 4 曲のジャケット URL */
  rankingCovers?: string[];
  /** 検索タブに表示する、今週のランキング上位曲 */
  rankingPreview?: Array<{ rank: number; song: Song }>;
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
  j_pop: "from-pink-950/88 via-rose-950/45 to-black/25",
  j_rock: "from-orange-950/88 via-red-950/45 to-black/25",
  anison: "from-sky-950/88 via-indigo-950/45 to-black/25",
  vocaloid_utaite: "from-cyan-950/88 via-teal-950/45 to-black/25",
  idol_female: "from-fuchsia-950/88 via-pink-950/45 to-black/25",
  idol_male: "from-blue-950/88 via-indigo-950/45 to-black/25",
  rnb_soul: "from-amber-950/88 via-yellow-950/45 to-black/25",
  hiphop: "from-zinc-900/92 via-zinc-950/55 to-black/25",
  enka_kayo: "from-red-950/88 via-rose-950/45 to-black/25",
  western: "from-emerald-950/88 via-green-950/45 to-black/25",
  kpop: "from-purple-950/88 via-violet-950/45 to-black/25",
  game_bgm: "from-lime-950/88 via-emerald-950/45 to-black/25",
  other: "from-slate-900/92 via-slate-950/55 to-black/25",
};

const DEBOUNCE_MS = 200;
const RECOMMENDATION_LIMIT = 20;

type SearchMode = "browse" | "search-empty" | "search-results";

function matchesSongFilters(
  song: Song,
  highMinMidi: number | null,
  highMaxMidi: number | null,
  selectedDecades: number[],
): boolean {
  if (
    highMinMidi != null &&
    (song.range_high_midi == null || song.range_high_midi < highMinMidi)
  ) {
    return false;
  }
  if (
    highMaxMidi != null &&
    (song.range_high_midi == null || song.range_high_midi > highMaxMidi)
  ) {
    return false;
  }
  if (selectedDecades.length === 0) return true;
  if (song.release_year == null) return false;
  return selectedDecades.some(
    (start) => song.release_year! >= start && song.release_year! <= start + 9,
  );
}

export function LiveSearch({
  ratings,
  knownSongIds = [],
  genreCovers = {},
  rankingCovers = [],
  rankingPreview = [],
}: LiveSearchProps) {
  const [query, setQuery] = useState("");
  const [highMax, setHighMax] = useState("");
  const [highMin, setHighMin] = useState("");
  const [selectedDecades, setSelectedDecades] = useState<number[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [history, setHistory] = useState<RecentItem[]>(() => loadHistory());
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const isSearchOpenRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const queryRef = useRef(query);
  const recommendationsRequestedRef = useRef(false);
  const recommendationsAbortRef = useRef<AbortController | null>(null);
  const [supabase] = useState(() => createClient());

  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);
  const highMinMidi = (highMin ? karaokeToMidi(highMin) : null) ?? null;
  const highMaxMidi = (highMax ? karaokeToMidi(highMax) : null) ?? null;

  const filteredRecommendations = useMemo(
    () =>
      recommendations
        .filter((song) =>
          matchesSongFilters(
            song,
            highMinMidi,
            highMaxMidi,
            selectedDecades,
          ),
        )
        .slice(0, RECOMMENDATION_LIMIT),
    [recommendations, highMinMidi, highMaxMidi, selectedDecades],
  );

  const filteredResults = useMemo<SearchResponse | null>(() => {
    if (!results) return null;
    return {
      ...results,
      songs: results.songs.filter((song) =>
        matchesSongFilters(
          song,
          highMinMidi,
          highMaxMidi,
          selectedDecades,
        ),
      ),
    };
  }, [results, highMinMidi, highMaxMidi, selectedDecades]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  const loadRecommendations = useCallback(() => {
    if (recommendationsRequestedRef.current) return;

    recommendationsRequestedRef.current = true;
    const ctrl = new AbortController();
    recommendationsAbortRef.current = ctrl;
    setRecommendationsLoading(true);
    setRecommendationsError(false);

    void (async () => {
      try {
        const { data, error } = await supabase
          .rpc("get_search_recommendations", {
            p_limit: RECOMMENDATION_LIMIT,
          })
          .abortSignal(ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (error || !Array.isArray(data)) {
          recommendationsRequestedRef.current = false;
          setRecommendationsError(true);
          return;
        }
        setRecommendations(data as unknown as Song[]);
      } catch {
        if (!ctrl.signal.aborted) {
          recommendationsRequestedRef.current = false;
          setRecommendationsError(true);
        }
      } finally {
        if (recommendationsAbortRef.current === ctrl) {
          recommendationsAbortRef.current = null;
        }
        if (!ctrl.signal.aborted) setRecommendationsLoading(false);
      }
    })();
  }, [supabase]);

  useEffect(
    () => () => {
      recommendationsAbortRef.current?.abort();
    },
    [],
  );

  // BottomNav の検索タブ再タップで、検索トップと検索モードを切り替える。
  useEffect(() => {
    const handler = () => {
      if (isSearchOpenRef.current) {
        isSearchOpenRef.current = false;
        setIsSearchOpen(false);
        setQuery("");
        setResults(null);
        setLoading(false);
        setErrMsg(null);
        inputRef.current?.blur();
        return;
      }

      isSearchOpenRef.current = true;
      setIsSearchOpen(true);
      loadRecommendations();
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
    window.addEventListener("app:toggle-search", handler);
    return () => window.removeEventListener("app:toggle-search", handler);
  }, [loadRecommendations]);

  // 未入力の検索欄にフォーカスしたまま下へスクロールし始めたら、
  // モバイルのソフトウェアキーボードを閉じる。横スクロールは対象外にする。
  useEffect(() => {
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStartRef.current = touch
        ? { x: touch.clientX, y: touch.clientY }
        : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const start = touchStartRef.current;
      const touch = event.touches[0];
      if (
        !start ||
        !touch ||
        queryRef.current.length > 0 ||
        document.activeElement !== inputRef.current
      ) {
        return;
      }

      const deltaX = touch.clientX - start.x;
      const deltaY = start.y - touch.clientY;
      if (deltaY > 10 && deltaY > Math.abs(deltaX)) {
        inputRef.current?.blur();
        touchStartRef.current = null;
      }
    };

    const clearTouchStart = () => {
      touchStartRef.current = null;
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", clearTouchStart, { passive: true });
    window.addEventListener("touchcancel", clearTouchStart, { passive: true });

    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", clearTouchStart);
      window.removeEventListener("touchcancel", clearTouchStart);
    };
  }, []);

  const trimmedQ = query.trim();
  const hasQueryInput = query.length > 0;

  // サーバー検索 (debounce + AbortController で多重発火を抑制)
  useEffect(() => {
    if (trimmedQ.length === 0) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setErrMsg(null);
      const highMinMidi = (highMin ? karaokeToMidi(highMin) : undefined) ?? undefined;
      const highMaxMidi = (highMax ? karaokeToMidi(highMax) : undefined) ?? undefined;
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

  // 検索タブを「通常」「検索を開いた未入力」「検索を開いた入力あり」の
  // 3 状態に分ける。空白も入力として扱い、入力あり画面を維持する。
  const mode: SearchMode = hasQueryInput
    ? "search-results"
    : isSearchOpen
      ? "search-empty"
      : "browse";

  const handleClear = useCallback(() => {
    setQuery("");
    setResults(null);
    setLoading(false);
    setErrMsg(null);
    inputRef.current?.focus();
  }, []);

  const handleQueryChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
    if (nextQuery.trim().length > 0) return;
    setResults(nextQuery.length > 0 ? { artists: [], songs: [] } : null);
    setLoading(false);
    setErrMsg(null);
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

  const handleToggleDecade = useCallback((start: number) => {
    setSelectedDecades((previous) =>
      previous.includes(start)
        ? previous.filter((decade) => decade !== start)
        : [...previous, start],
    );
  }, []);

  // 検索欄を一度開いたら、このページを離れるまで検索状態を維持する。
  // フォーカス解除では閉じないため、モバイルのキーボード開閉にも影響されない。
  const onFilterFocus = () => {
    isSearchOpenRef.current = true;
    setIsSearchOpen(true);
    loadRecommendations();
  };

  return (
    <div className="space-y-4">
      <div
        className="space-y-4"
        onFocus={onFilterFocus}
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
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="楽曲・アーティストを検索"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            // search 型ネイティブの clear ボタンは UI が分散するので非表示
            className="w-full rounded-lg bg-zinc-100 py-2 pl-9 pr-9 text-sm placeholder:text-zinc-500 focus:outline-none dark:bg-zinc-800 dark:placeholder:text-zinc-400 [&::-webkit-search-cancel-button]:hidden"
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

        {mode === "search-empty" ? (
          <>
            <HistoryList
              history={history.slice(0, 3)}
              onRemove={handleRemoveHistory}
              onSelectSong={handleSelectSong}
              onSelectArtist={handleSelectArtist}
              ratings={ratings}
              knownSet={knownSet}
            />
            <PitchSearch
              highMin={highMin}
              highMax={highMax}
              onHighMinChange={setHighMin}
              onHighMaxChange={setHighMax}
            />
            <DecadeChips
              selected={selectedDecades}
              onToggle={handleToggleDecade}
            />
            <RecommendationList
              recommendations={filteredRecommendations}
              loading={recommendationsLoading}
              hasError={recommendationsError}
              hasActiveFilters={Boolean(
                highMin || highMax || selectedDecades.length > 0
              )}
              ratings={ratings}
              knownSet={knownSet}
              onSelectSong={handleSelectSong}
            />
          </>
        ) : mode === "search-results" ? (
          <>
            <PitchSearch
              highMin={highMin}
              highMax={highMax}
              onHighMinChange={setHighMin}
              onHighMaxChange={setHighMax}
            />
            <DecadeChips
              selected={selectedDecades}
              onToggle={handleToggleDecade}
            />
            <section>
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                検索結果
              </h2>
              <ResultsList
                loading={loading}
                errMsg={errMsg}
                results={filteredResults}
                ratings={ratings}
                knownSet={knownSet}
                onSelectSong={handleSelectSong}
                onSelectArtist={handleSelectArtist}
              />
            </section>
          </>
        ) : null}
      </div>

      {mode === "browse" ? (
        <BrowseGrid
          genreCovers={genreCovers}
          rankingCovers={rankingCovers}
          rankingPreview={rankingPreview}
          ratings={ratings}
          knownSet={knownSet}
        />
      ) : null}
    </div>
  );
}

function PitchSearch({
  highMin,
  highMax,
  onHighMinChange,
  onHighMaxChange,
}: {
  highMin: string;
  highMax: string;
  onHighMinChange: (value: string) => void;
  onHighMaxChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <select
        value={highMin}
        onChange={(e) => onHighMinChange(e.target.value)}
        aria-label="最高音の下限"
        className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none dark:bg-zinc-800"
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
        onChange={(e) => onHighMaxChange(e.target.value)}
        aria-label="最高音の上限"
        className="flex-1 rounded bg-zinc-100 px-2 py-1.5 text-sm focus:outline-none dark:bg-zinc-800"
      >
        {HIGH_OPTIONS.map((v) => (
          <option key={`max-${v}`} value={v}>
            {v || "—"}
          </option>
        ))}
      </select>
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
  rankingCovers,
  rankingPreview,
  ratings,
  knownSet,
}: {
  genreCovers: Partial<Record<GenreCode, string[]>>;
  rankingCovers: string[];
  rankingPreview: Array<{ rank: number; song: Song }>;
  ratings: Record<string, string>;
  knownSet: Set<string>;
}) {
  return (
    <section>
      <ul className="grid grid-cols-2 gap-2">
        {/* 「今週のランキング」エントリ。col-span-2 で全幅、aspect は
            ジャンルカード半分弱の高さに揃えて視覚的バランスを取る。 */}
        <li className="col-span-2">
          <Link
            href="/rankings"
            className="relative flex aspect-[16/5] items-center overflow-hidden rounded-lg bg-zinc-900 px-4 py-3 transition active:scale-[0.98]"
          >
            {rankingCovers.length > 0 ? (
              // 横長カードなので 4 列 1 行のストリップでジャケットを敷く
              <div
                className="absolute inset-0 grid grid-cols-4"
                aria-hidden
              >
                {[0, 1, 2, 3].map((i) => {
                  const src =
                    rankingCovers[i] ??
                    rankingCovers[i % Math.max(rankingCovers.length, 1)];
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
            {/* ランキング識別色: amber/orange 系で「熱量」を表現 */}
            <div
              className="absolute inset-0 bg-gradient-to-br from-amber-950/88 via-orange-950/45 to-black/30"
              aria-hidden
            />
            {/* 2px ガラスリム (ジャンルカードと同じ手法) */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-lg"
              style={{
                padding: "2px",
                background: "rgba(255,255,255,0.18)",
                backdropFilter: "blur(20px) brightness(1.2) saturate(1.4)",
                WebkitBackdropFilter:
                  "blur(20px) brightness(1.2) saturate(1.4)",
                WebkitMask:
                  "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor",
                mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                maskComposite: "exclude",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                maskImage:
                  "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
                WebkitMaskImage:
                  "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
              }}
            />
            <div className="relative z-10 flex items-center gap-2">
              <TrendingUp
                className="size-4 text-amber-200 drop-shadow-md"
                aria-hidden
              />
              <span className="text-sm font-extrabold leading-tight tracking-tight text-zinc-100 drop-shadow-md">
                今週のランキング
              </span>
            </div>
          </Link>
        </li>
        {rankingPreview.length > 0 ? (
          <li className="col-span-2 rounded-lg bg-zinc-50 px-2 py-3 dark:bg-zinc-900/70">
            <div className="mb-1 flex items-center justify-between px-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                今週のランキング
              </h3>
              <Link
                href="/rankings"
                className="text-xs font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                もっと見る ›
              </Link>
            </div>
            <ol className="space-y-0.5">
              {rankingPreview.map(({ rank, song }) => (
                <li key={song.id} className="flex items-center gap-1">
                  <span className="w-6 shrink-0 text-right text-sm font-bold tabular-nums text-zinc-500 dark:text-zinc-400">
                    {rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <SongCard
                      song={song}
                      rating={ratings[song.id] ?? null}
                      isKnown={knownSet.has(song.id)}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ) : null}
        {/* 「年代別J-POP」エントリ。col-span-2 で全幅。視覚的にランキング
            カードと並ぶ。色は元の j_pop カードと同じピンク/ローズ系を踏襲。 */}
        <li className="col-span-2">
          <Link
            href="/songs/genre/j_pop"
            className="relative flex aspect-[16/5] items-center overflow-hidden rounded-lg bg-zinc-900 px-4 py-3 transition active:scale-[0.98]"
          >
            {(genreCovers.j_pop ?? []).length > 0 ? (
              <div
                className="absolute inset-0 grid grid-cols-4"
                aria-hidden
              >
                {[0, 1, 2, 3].map((i) => {
                  const covers = genreCovers.j_pop ?? [];
                  const src = covers[i] ?? covers[i % Math.max(covers.length, 1)];
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
            <div
              className="absolute inset-0 bg-gradient-to-br from-pink-950/88 via-rose-950/45 to-black/30"
              aria-hidden
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-lg"
              style={{
                padding: "2px",
                background: "rgba(255,255,255,0.18)",
                backdropFilter: "blur(20px) brightness(1.2) saturate(1.4)",
                WebkitBackdropFilter:
                  "blur(20px) brightness(1.2) saturate(1.4)",
                WebkitMask:
                  "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                WebkitMaskComposite: "xor",
                mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
                maskComposite: "exclude",
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
                maskImage:
                  "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
                WebkitMaskImage:
                  "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
              }}
            />
            <div className="relative z-10 flex items-center gap-2">
              <CalendarRange
                className="size-4 text-pink-200 drop-shadow-md"
                aria-hidden
              />
              <span className="text-sm font-extrabold leading-tight tracking-tight text-zinc-100 drop-shadow-md">
                年代別J-POP
              </span>
            </div>
          </Link>
        </li>
        {BROWSE_GENRE_CODES.filter((c) => c !== "j_pop").map((code) => {
          const covers = genreCovers[code] ?? [];
          return (
            <li key={code}>
              <Link
                href={`/songs/genre/${code}`}
                className="relative flex aspect-[16/10] items-start overflow-hidden rounded-lg bg-zinc-900 pl-4 pr-3 pt-4 pb-3 transition active:scale-[0.98]"
              >
                {covers.length > 0 ? (
                  // Bento 配置: 左列は a (上 2/3) + d (下 1/3)、
                  // 右列は b (上 1/2) + c (下 1/2)。
                  // 左右で seam の高さがずれることで安定しすぎない構図に。
                  // 6 等分の行で、a=1-4, d=5-6, b=1-3, c=4-6 を割り当てる。
                  <div
                    className="absolute inset-0 grid"
                    style={{
                      gridTemplateColumns: "3fr 2fr",
                      gridTemplateRows: "repeat(6, 1fr)",
                      gridTemplateAreas:
                        '"a b" "a b" "a b" "a c" "d c" "d c"',
                    }}
                    aria-hidden
                  >
                    {(["a", "b", "c", "d"] as const).map((area, i) => {
                      const src = covers[i] ?? covers[i % covers.length];
                      return (
                        <div
                          key={area}
                          className="relative bg-zinc-800"
                          style={{ gridArea: area }}
                        >
                          {src ? (
                            <JacketImage
                              src={src}
                              alt=""
                              fill
                              sizes="(max-width: 640px) 30vw, 15vw"
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
                {/* 左上 → 右下方向の勾配 blur。
                    backdrop-filter で全面に blur を効かせつつ、
                    mask-image の linear-gradient(135deg, black, transparent)
                    で左上だけ不透明・右下に向けて透明にすることで、
                    結果として「左上が強い blur, 右下はシャープ」のグラデ
                    blur に見える。 */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backdropFilter: "blur(10px)",
                    WebkitBackdropFilter: "blur(10px)",
                    maskImage:
                      "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
                    WebkitMaskImage:
                      "linear-gradient(135deg, black 0%, black 25%, transparent 80%)",
                  }}
                />
                <span className="relative z-10 text-sm font-extrabold leading-tight tracking-tight text-zinc-200 drop-shadow-md">
                  {GENRE_LABELS[code]}
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
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        最近検索したもの
      </h2>
      {history.length > 0 ? (
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
                      duration_ms: null,
                    }}
                    rating={ratings[item.id] ?? null}
                    isKnown={knownSet.has(item.id)}
                    onSelect={onSelectSong}
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
      ) : (
        <p className="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          最近の検索はまだありません
        </p>
      )}
    </section>
  );
}

// ============================================================================
// Recommendations: 検索前に表示するおすすめ楽曲
// ============================================================================
function RecommendationList({
  recommendations,
  loading,
  hasError,
  hasActiveFilters,
  ratings,
  knownSet,
  onSelectSong,
}: {
  recommendations: Song[];
  loading: boolean;
  hasError: boolean;
  hasActiveFilters: boolean;
  ratings: Record<string, string>;
  knownSet: Set<string>;
  onSelectSong: (song: Song) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
        おすすめ
      </h2>
      {recommendations.length > 0 ? (
        <ul>
          {recommendations.map((song) => (
            <li key={song.id}>
              <SongCard
                song={song}
                rating={ratings[song.id] ?? null}
                isKnown={knownSet.has(song.id)}
                onSelect={onSelectSong}
              />
            </li>
          ))}
        </ul>
      ) : loading ? (
        <p className="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          おすすめを読み込み中…
        </p>
      ) : hasError ? (
        <p className="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          おすすめを読み込めませんでした
        </p>
      ) : (
        <p className="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          {hasActiveFilters
            ? "条件に合うおすすめはありません"
            : "おすすめを準備中です"}
        </p>
      )}
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
              <li key={s.id}>
                <SongCard
                  song={s}
                  rating={ratings[s.id] ?? null}
                  isKnown={knownSet.has(s.id)}
                  onSelect={onSelectSong}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

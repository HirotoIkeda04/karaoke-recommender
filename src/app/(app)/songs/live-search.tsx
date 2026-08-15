"use client";

import { TrendingUp, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArtistRow, type ArtistRowData } from "@/components/artist-row";
import { DecadeChips } from "@/components/decade-chips";
import { PitchRangePicker } from "@/components/pitch-range-picker";
import { useSearchBar } from "@/components/search-bar-context";
import { SongCard } from "@/components/song-card";
import { JacketImage } from "@/components/ui/jacket-image";
import {
  BROWSE_GENRE_CODES,
  GENRE_LABELS,
  type GenreCode,
} from "@/lib/genres";
import { karaokeToMidi } from "@/lib/note";
import {
  clearHistory,
  loadHistory,
  pushHistory,
  type RecentArtist,
  type RecentItem,
  type RecentSong,
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
  /** ジャンルカード右下の丸い画像に使う、各ジャンル top 4 曲のジャケット URL */
  genreCovers?: Partial<Record<GenreCode, string[]>>;
  /** ランキングカード背景に使う、今週 top 4 曲のジャケット URL */
  rankingCovers?: string[];
  /** 検索タブに表示する、今週のランキング上位曲 */
  rankingPreview?: Array<{ rank: number; song: Song }>;
}

// 写真に色を被せず、ジャンルごとの落ち着いた単色をカード全面に使う。
const GENRE_CARD_COLORS: Record<GenreCode, string> = {
  j_pop: "#8b3f5c",
  j_rock: "#844234",
  anison: "#405b91",
  vocaloid_utaite: "#286c72",
  idol_female: "#994769",
  idol_male: "#465b8c",
  rnb_soul: "#79583c",
  hiphop: "#595442",
  enka_kayo: "#74434d",
  western: "#426b59",
  kpop: "#684f82",
  game_bgm: "#5a7047",
  other: "#525c68",
};

const GENRE_COVER_BUBBLES = [
  { size: 48, right: -8, bottom: -6, zIndex: 5 },
  { size: 48, right: 27, bottom: 4, zIndex: 4 },
  { size: 48, right: 62, bottom: -2, zIndex: 3 },
  { size: 48, right: 8, bottom: 38, zIndex: 2 },
  { size: 48, right: 43, bottom: 42, zIndex: 1 },
] as const;

const DEBOUNCE_MS = 200;
const RECOMMENDATION_LIMIT = 50;
// 「最近の検索」はアーティスト (横スクロール) と楽曲 (縦リスト) で上限を分ける
const RECENT_ARTIST_LIMIT = 10;
const RECENT_SONG_LIMIT = 3;

type SearchMode = "browse" | "search-empty" | "search-results";

/** 参照が変わらないよう module スコープに置く (memo の入力になる)。 */
const EMPTY_RESULTS: SearchResponse = { artists: [], songs: [] };

/** 直近に返ってきた検索結果と、それがどの要求に対するものか。 */
interface SettledSearch {
  /** 検索語 + 音域フィルタ。これが現在の要求と一致していれば最新。 */
  key: string;
  /** 検索語のみ。入力途中で前の結果を出し続けてよいかの判定に使う。 */
  q: string;
  data: SearchResponse;
  error: string | null;
}

interface RecommendationFilters {
  lowMidi: number | null;
  highMidi: number | null;
  selectedDecades: number[];
}

function recommendationCacheKey({
  lowMidi,
  highMidi,
  selectedDecades,
}: RecommendationFilters): string {
  return [
    lowMidi ?? "",
    highMidi ?? "",
    [...selectedDecades].sort((a, b) => a - b).join(","),
  ].join("|");
}

// 指定した最低音〜最高音の範囲に曲の音域が収まるかで絞り込む。
//   - 最低音指定時: range_low_midi がそれ未満 (より低い) の曲を除外
//   - 最高音指定時: range_high_midi がそれ超 (より高い) の曲を除外
function matchesSongFilters(
  song: Song,
  lowMidi: number | null,
  highMidi: number | null,
  selectedDecades: number[],
): boolean {
  if (
    lowMidi != null &&
    (song.range_low_midi == null || song.range_low_midi < lowMidi)
  ) {
    return false;
  }
  if (
    highMidi != null &&
    (song.range_high_midi == null || song.range_high_midi > highMidi)
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
  // 入力欄そのものは画面下部のバー (AppSearchBar) 側にある。
  // ここが持つのは、その入力に対する検索結果と周辺の状態だけ。
  const { query, open: isSearchOpen, reset: resetSearchBar } = useSearchBar();

  const [highNote, setHighNote] = useState("");
  const [lowNote, setLowNote] = useState("");
  const [selectedDecades, setSelectedDecades] = useState<number[]>([]);
  const [history, setHistory] = useState<RecentItem[]>(() => loadHistory());
  // 検索結果は「どの要求に対する結果か」ごと持つ。入力や絞り込みが変われば
  // 自動的に古くなるので、入力を消したときに結果を捨てる effect が要らない。
  const [settled, setSettled] = useState<SettledSearch | null>(null);
  const [recommendations, setRecommendations] = useState<Song[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState(false);

  const recommendationsCacheRef = useRef(new Map<string, Song[]>());
  const recommendationsAbortRef = useRef<AbortController | null>(null);
  const [supabase] = useState(() => createClient());

  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);
  const lowMidi = (lowNote ? karaokeToMidi(lowNote) : null) ?? null;
  const highMidi = (highNote ? karaokeToMidi(highNote) : null) ?? null;

  const filteredRecommendations = useMemo(
    () =>
      recommendations
        .filter((song) =>
          matchesSongFilters(
            song,
            lowMidi,
            highMidi,
            selectedDecades,
          ),
        )
        .slice(0, RECOMMENDATION_LIMIT),
    [recommendations, lowMidi, highMidi, selectedDecades],
  );

  // 検索タブを離れたら検索状態を捨てる。バーの状態は layout 側の provider に
  // 置いてあり、ページを離れても生き残ってしまうため、ここで畳む。
  useEffect(() => resetSearchBar, [resetSearchBar]);

  const loadRecommendations = useCallback((filters: RecommendationFilters) => {
    const sortedDecades = [...filters.selectedDecades].sort((a, b) => a - b);
    const cacheKey = recommendationCacheKey({
      ...filters,
      selectedDecades: sortedDecades,
    });
    const cached = recommendationsCacheRef.current.get(cacheKey);

    recommendationsAbortRef.current?.abort();
    if (cached) {
      recommendationsAbortRef.current = null;
      setRecommendations(cached);
      setRecommendationsLoading(false);
      setRecommendationsError(false);
      return;
    }

    const ctrl = new AbortController();
    recommendationsAbortRef.current = ctrl;
    setRecommendationsLoading(true);
    setRecommendationsError(false);

    const rpcArgs: Database["public"]["Functions"]["get_search_recommendations"]["Args"] = {
      p_limit: RECOMMENDATION_LIMIT,
    };
    if (sortedDecades.length > 0) rpcArgs.p_decades = sortedDecades;
    if (filters.highMidi != null) {
      rpcArgs.p_high_midi = filters.highMidi;
    }
    if (filters.lowMidi != null) {
      rpcArgs.p_low_midi = filters.lowMidi;
    }

    void (async () => {
      try {
        const { data, error } = await supabase
          .rpc("get_search_recommendations", rpcArgs)
          .abortSignal(ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (error || !Array.isArray(data)) {
          setRecommendationsError(true);
          return;
        }
        const nextRecommendations = data as unknown as Song[];
        recommendationsCacheRef.current.set(cacheKey, nextRecommendations);
        setRecommendations(nextRecommendations);
      } catch {
        if (!ctrl.signal.aborted) {
          setRecommendationsError(true);
        }
      } finally {
        if (recommendationsAbortRef.current === ctrl) {
          recommendationsAbortRef.current = null;
          setRecommendationsLoading(false);
        }
      }
    })();
  }, [supabase]);

  // 絞り込み条件を DB 側へ渡し、条件適用後の候補を最大50曲取得する。
  // 連続タップは短くまとめ、切り替え前の結果は新しい結果が届くまで保持する。
  useEffect(() => {
    if (!isSearchOpen || query.length > 0) return;

    const timer = window.setTimeout(() => {
      loadRecommendations({
        lowMidi,
        highMidi,
        selectedDecades,
      });
    }, 120);

    return () => window.clearTimeout(timer);
  }, [
    highMidi,
    isSearchOpen,
    loadRecommendations,
    lowMidi,
    query,
    selectedDecades,
  ]);

  useEffect(
    () => () => {
      recommendationsAbortRef.current?.abort();
    },
    [],
  );

  const trimmedQ = query.trim();
  const hasQueryInput = query.length > 0;
  const requestKey = `${trimmedQ} ${lowNote} ${highNote}`;

  // サーバー検索 (debounce + AbortController で多重発火を抑制)
  useEffect(() => {
    if (trimmedQ.length === 0) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      const lowMidiArg = (lowNote ? karaokeToMidi(lowNote) : undefined) ?? undefined;
      const highMidiArg = (highNote ? karaokeToMidi(highNote) : undefined) ?? undefined;
      const { data, error } = await supabase
        .rpc("search_songs_and_artists", {
          p_q: trimmedQ,
          p_low_midi: lowMidiArg,
          p_high_midi: highMidiArg,
        })
        .abortSignal(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setSettled({
        key: requestKey,
        q: trimmedQ,
        // RPC は jsonb を返すので shape を信じてキャスト
        data: error
          ? EMPTY_RESULTS
          : ((data ?? EMPTY_RESULTS) as unknown as SearchResponse),
        error: error ? error.message : null,
      });
    }, DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [requestKey, trimmedQ, lowNote, highNote, supabase]);

  // 結果が届くまでは前の結果を薄く出し続けたい。ただし、いったん入力を
  // 消して別の語を打ち直したときにまで残ると、無関係な結果を見せることに
  // なる。前後どちらかがもう一方の先頭一致なら「同じ検索の続き」とみなす。
  const continued =
    settled &&
    (trimmedQ.startsWith(settled.q) || settled.q.startsWith(trimmedQ))
      ? settled
      : null;

  const loading = trimmedQ.length > 0 && settled?.key !== requestKey;
  const errMsg = settled?.key === requestKey ? settled.error : null;
  const results: SearchResponse | null =
    trimmedQ.length > 0
      ? (continued?.data ?? null)
      : // 空白だけの入力も「入力あり」の画面を維持したいので、該当なし扱い
        (hasQueryInput ? EMPTY_RESULTS : null);

  // 音域・年代の絞り込みは RPC 側にも渡しているが、結果が届くまでの間に
  // 条件を変えても即座に効くよう、クライアント側でも同じ条件で絞る。
  const filteredResults = useMemo<SearchResponse | null>(() => {
    if (!results) return null;
    return {
      ...results,
      songs: results.songs.filter((song) =>
        matchesSongFilters(song, lowMidi, highMidi, selectedDecades),
      ),
    };
  }, [results, lowMidi, highMidi, selectedDecades]);

  // 検索タブを「通常」「検索を開いた未入力」「検索を開いた入力あり」の
  // 3 状態に分ける。空白も入力として扱い、入力あり画面を維持する。
  const mode: SearchMode = hasQueryInput
    ? "search-results"
    : isSearchOpen
      ? "search-empty"
      : "browse";

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

  const handleClearHistory = useCallback(() => {
    if (!window.confirm("最近の検索をすべて削除しますか？")) return;
    clearHistory();
    setHistory([]);
  }, []);

  const handleToggleDecade = useCallback((start: number) => {
    setSelectedDecades((previous) =>
      previous.includes(start)
        ? previous.filter((decade) => decade !== start)
        : [...previous, start],
    );
  }, []);

  return (
    <div className="space-y-4">
      {/* 入力欄はここには無い。画面下部のバー (AppSearchBar) が持っていて、
          このツリーは入力に対する結果だけを描く。 */}
      <div className="space-y-4">
        {mode === "search-empty" ? (
          <>
            <HistoryList
              history={history}
              onClear={handleClearHistory}
              onSelectSong={handleSelectSong}
              onSelectArtist={handleSelectArtist}
              ratings={ratings}
              knownSet={knownSet}
            />
            <div className="space-y-3">
              <PitchRangePicker
                low={lowNote}
                high={highNote}
                onChange={(low, high) => {
                  setLowNote(low);
                  setHighNote(high);
                }}
              />
              <DecadeChips
                selected={selectedDecades}
                onToggle={handleToggleDecade}
              />
            </div>
            <RecommendationList
              recommendations={filteredRecommendations}
              loading={recommendationsLoading}
              hasError={recommendationsError}
              hasActiveFilters={Boolean(
                lowNote || highNote || selectedDecades.length > 0
              )}
              ratings={ratings}
              knownSet={knownSet}
              onSelectSong={handleSelectSong}
            />
          </>
        ) : mode === "search-results" ? (
          <>
            <div className="space-y-3">
              <PitchRangePicker
                low={lowNote}
                high={highNote}
                onChange={(low, high) => {
                  setLowNote(low);
                  setHighNote(high);
                }}
              />
              <DecadeChips
                selected={selectedDecades}
                onToggle={handleToggleDecade}
              />
            </div>
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

// ============================================================================
// Browse: ジャンルカードグリッド
//   - ジャンル固有の単色を背景にし、上位曲のジャケットを右下へ円形に重ねる。
//   - covers が空でも単色カードとして成立させる。
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
  const rankingPages = Array.from(
    { length: Math.ceil(rankingPreview.length / 5) },
    (_, pageIndex) =>
      rankingPreview.slice(pageIndex * 5, (pageIndex + 1) * 5)
  );
  const [rankingPage, setRankingPage] = useState(0);
  const rankingMouseDragRef = useRef<{
    pointerId: number;
    x: number;
    scrollLeft: number;
  } | null>(null);
  const rankingDidDragRef = useRef(false);

  const handleRankingMouseDown = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    rankingDidDragRef.current = false;
    rankingMouseDragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleRankingMouseMove = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const start = rankingMouseDragRef.current;
    if (!start || start.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - start.x;
    if (Math.abs(deltaX) > 4) rankingDidDragRef.current = true;
    event.currentTarget.scrollLeft = start.scrollLeft - deltaX;
  };

  const handleRankingMouseUp = (
    event: React.PointerEvent<HTMLDivElement>
  ) => {
    const start = rankingMouseDragRef.current;
    rankingMouseDragRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;

    const viewport = event.currentTarget;
    const page = Math.round(viewport.scrollLeft / viewport.clientWidth);
    viewport.scrollTo({
      left: page * viewport.clientWidth,
      behavior: "smooth",
    });
    setRankingPage(page);
    window.setTimeout(() => {
      rankingDidDragRef.current = false;
    }, 0);
  };

  const handleRankingScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget;
    if (viewport.clientWidth === 0) return;
    const page = Math.min(
      Math.round(viewport.scrollLeft / viewport.clientWidth),
      rankingPages.length - 1
    );
    setRankingPage(page);
  };

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
          <li className="col-span-2 py-3">
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
            <div
              className="-mx-2 cursor-grab snap-x snap-mandatory select-none overflow-x-auto overscroll-x-contain scroll-smooth active:cursor-grabbing [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              role="region"
              aria-roledescription="カルーセル"
              aria-label="今週のランキング 1位から50位"
              onScroll={handleRankingScroll}
              onPointerDown={handleRankingMouseDown}
              onPointerMove={handleRankingMouseMove}
              onPointerUp={handleRankingMouseUp}
              onPointerCancel={() => {
                rankingMouseDragRef.current = null;
                rankingDidDragRef.current = false;
              }}
              onClickCapture={(event) => {
                if (!rankingDidDragRef.current) return;
                event.preventDefault();
                event.stopPropagation();
                rankingDidDragRef.current = false;
              }}
            >
              <div className="flex">
                {rankingPages.map((page, pageIndex) => (
                  <ol
                    key={page[0].rank}
                    className="min-w-full shrink-0 snap-start snap-always space-y-0.5 px-2"
                    aria-label={`${page[0].rank}位から${page[page.length - 1].rank}位`}
                    aria-hidden={rankingPage !== pageIndex}
                    inert={rankingPage !== pageIndex}
                  >
                    {page.map(({ rank, song }) => (
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
                ))}
              </div>
            </div>
          </li>
        ) : null}
        {BROWSE_GENRE_CODES.filter((code) => code !== "j_pop").map((code) => {
          const covers = genreCovers[code] ?? [];
          return (
            <li key={code}>
              <Link
                href={`/songs/genre/${code}`}
                className="relative flex aspect-video items-start overflow-hidden rounded-lg pl-4 pr-3 pt-4 pb-3 transition active:scale-[0.98]"
                style={{ backgroundColor: GENRE_CARD_COLORS[code] }}
              >
                {covers.length > 0 ? (
                  <div className="absolute inset-0" aria-hidden>
                    {covers.slice(0, 5).map((src, index) => {
                      const bubble = GENRE_COVER_BUBBLES[index];
                      return (
                        <div
                          key={src}
                          className="absolute overflow-hidden rounded-full border-[3px] border-solid bg-black/15"
                          style={{
                            width: bubble.size,
                            height: bubble.size,
                            right: bubble.right,
                            bottom: bubble.bottom,
                            zIndex: bubble.zIndex,
                            borderColor: GENRE_CARD_COLORS[code],
                          }}
                        >
                          <JacketImage
                            src={src}
                            alt=""
                            fill
                            sizes={`${bubble.size}px`}
                            className="object-cover"
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <span className="relative z-10 max-w-[58%] text-sm font-extrabold leading-tight tracking-tight text-white">
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
// History: タップした曲/アーティストの「最近の検索」
//   - アーティストは X (Twitter) の検索履歴風に丸アイコンの横スクロール
//   - 楽曲は従来通りの縦リストで、カルーセルの下に置く
//   - 削除は見出し行の × に集約する (項目ごとの × は常時表示で邪魔になる)
// ============================================================================
function HistoryList({
  history,
  onClear,
  onSelectSong,
  onSelectArtist,
  ratings,
  knownSet,
}: {
  history: RecentItem[];
  onClear: () => void;
  onSelectSong: (s: Song) => void;
  onSelectArtist: (a: ArtistRowData) => void;
  ratings: Record<string, string>;
  knownSet: Set<string>;
}) {
  const artists = history
    .filter((item): item is RecentArtist => item.type === "artist")
    .slice(0, RECENT_ARTIST_LIMIT);
  const songs = history
    .filter((item): item is RecentSong => item.type === "song")
    .slice(0, RECENT_SONG_LIMIT);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          最近の検索
        </h2>
        {artists.length > 0 || songs.length > 0 ? (
          // -my-1 で見出し行の高さを変えずにタップ領域だけ広げる
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            aria-label="最近の検索をすべて削除"
            className="-my-1 -mr-1 grid size-7 shrink-0 place-items-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {artists.length > 0 ? (
        // px-6 = ページの px-4 + SongCard の p-2。下の曲リストと左端を揃える
        <ul className="-mx-4 mb-2 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {artists.map((item) => (
            <li key={item.id} className="w-16 shrink-0">
              <Link
                href={`/artists/${item.id}`}
                onClick={() =>
                  onSelectArtist({
                    id: item.id,
                    name: item.name,
                    song_count: null,
                    image_url: item.image,
                  })
                }
                className="block focus:outline-none"
              >
                <div className="relative size-16 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  {item.image ? (
                    <JacketImage
                      src={item.image}
                      alt=""
                      fill
                      sizes="4rem"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl text-zinc-500">
                      {item.name.slice(0, 1)}
                    </div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-center text-xs font-medium text-zinc-900 dark:text-zinc-50">
                  {item.name}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {songs.length > 0 ? (
        <ul>
          {songs.map((item) => (
            <li key={item.id}>
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
            </li>
          ))}
        </ul>
      ) : null}
      {artists.length === 0 && songs.length === 0 ? (
        <p className="px-2 py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
          最近の検索はまだありません
        </p>
      ) : null}
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

"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Dices,
  FastForward,
  Minus,
  Music,
  Play,
  ScrollText,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { DumbbellMini } from "@/components/icons/dumbbell-mini";
import { useDeckDetail } from "@/components/deck-detail-context";
import { useIsGuest } from "@/components/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { JacketImage } from "@/components/ui/jacket-image";
import { useRatingActions } from "@/hooks/use-rating-actions";
import {
  getAudioContext,
  isAudioContextRunning,
  resumeAudioContext,
} from "@/lib/audio-context";
import { readGuestRatings } from "@/lib/guest-ratings";
import { filterUnratedGroups, shuffleGroups } from "@/lib/guest-songs";
import { triggerHaptic } from "@/lib/haptics";
import { buildMarkerFill, type MarkerFill } from "@/lib/marker-fill";
import {
  HIGHLIGHT_OPACITY,
  HIGHLIGHT_TILT_DEG,
  buildHighlight,
} from "@/lib/marker-highlight";
import { formatDuration, midiToKaraoke, noteChipColor } from "@/lib/note";
import { emitSparks } from "@/lib/rating-particles";
import { triggerRatingSound } from "@/lib/rating-sound";
import type { SimilarSong } from "@/lib/similar-songs";
import type { Database } from "@/types/database";

import { getSimilarSongs, shuffleDeck } from "./actions";
import { SimilarSongsCarousel } from "./similar-songs-carousel";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type Rating = Database["public"]["Enums"]["rating_type"];

/**
 * 試聴プレイヤー 1 台。音量は Web Audio の gain で動かす。iOS Safari は
 * HTMLMediaElement.volume を変更できないため、要素の volume ではフェードが
 * 表現できない (従来ここがハードカットに劣化していた)。gain が null なのは
 * Web Audio 自体が使えない環境で、その時だけ要素の volume に落ちる。
 */
interface SnippetPlayer {
  el: HTMLAudioElement;
  gain: GainNode | null;
}

/**
 * 1 曲の表示時間 (ms) = 試聴スニペットの尺。曲送りのタイマーと、終端の
 * フェードアウトの両方がこれを見る。揃っている必要があるのは「フェードが
 * 終わる瞬間」と「曲が変わる瞬間」だけなので、その 2 つは同じ起点
 * (snippetOriginRef) から数える。
 */
const SNIPPET_MS = 10000;

/**
 * 盤 1 周の時間 (ms)。見た目だけの値で、曲送りにも試聴にも関与しない
 * (回転の角度と再生位置は一致していなくてよい)。SNIPPET_MS と同じ値に
 * してあるのは「1 曲でおよそ 1 回転」に見せたいからで、連動はしていない。
 * 片方を変えても、もう片方は変えなくてよい。
 */
const ROTATION_MS = 10000;

/**
 * 自動送りのクロスフェード長 (ms)。尺の終わり CROSSFADE_AUTO_MS 前から
 * 次の曲を重ね始める (前の曲が落ちながら次の曲が立ち上がる)。
 */
const CROSSFADE_AUTO_MS = 2000;

/**
 * 評価した瞬間に試聴を絞る量と時間 (サイドチェイン)。評価音は試聴より
 * ずっと小さいので、そのままだと音楽に埋もれて聞こえない。押した直後だけ
 * 試聴を下げ、評価音が鳴り終わる頃に戻す。
 */
const DUCK_LEVEL = 0.25;
const DUCK_ATTACK_S = 0.06;
const DUCK_HOLD_S = 0.22;
const DUCK_RELEASE_S = 0.45;

/**
 * 評価 / スキップ / 戻る で送った時のクロスフェード長 (ms)。タップへの
 * 反応なので自動送りより短くする (長いと操作が重く感じる)。曲の頭出しや
 * 消音解除のフェードインにもこの長さを使う。
 */
const CROSSFADE_TAP_MS = 800;

/**
 * 再生アンロック用の極小無音 WAV。iOS Safari は「ユーザー操作中に play()
 * した <audio> 要素」だけが以後のプログラム再生を許可されるため、タップ時
 * に音源が無い曲でもこれを一度鳴らして要素をアンロックしておく。
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/**
 * ディスク径。横幅いっぱい (左右 1.75rem マージン) を基本に、
 * 縦に収まらない小さい画面ではヘッダー + 組カルーセル + 曲名 +
 * ボタン群 + ナビの予約分 (約 29.25rem) を引いた残りへ縮める。上限 20rem。
 * loading.tsx の skeleton と式を揃えること。
 * 内訳: pt-3 0.75 + 組カルーセル 3.5 + gap 1.5 + 曲名 1.75 + gap 1.5 +
 * (盤) + gap 1.5 + 評価 4.875 + gap 1.5 + スキップ行 3.5 + pb-2 0.5 から
 * 曲名行の -my-2 (1rem) を引いた 20.125rem に、ヘッダーと浮いたナビの実測 9.125rem を足した値。
 */
const DISC_SIZE =
  "min(20rem, calc(100vw - 3.5rem), max(8rem, calc(100svh - 29.25rem - env(safe-area-inset-bottom))))";

/**
 * 詳細表示 (上スワイプ) 中のディスク径。通常時に対して、組カルーセルの行が
 * 座布団 1 行まで縮み、スキップ行が消える代わりに、楽曲情報 + 各サービスの
 * ボタン + 似た音域のカルーセルが入る。ナビ用の下余白はデッキ側の
 * marginBottom で打ち消しているので、その 5rem はここから引いてある。
 * 下限を 6rem まで下げてあるのは、載せる情報が通常時より多いぶん、
 * 縦の狭い端末では盤を通常時より小さく畳んで全部を収めるため。
 */
const DISC_SIZE_DETAIL =
  "min(20rem, calc(100vw - 3.5rem), max(6rem, calc(100svh - 35.75rem - env(safe-area-inset-bottom))))";

/**
 * 座布団の top (px)。サムネイル (56px) の下辺をまたいで貼り、
 * 高さ 24px のうち 16px がジャケットに被る。
 */
const PILLOW_OVERLAP_TOP = 40;

/** 座布団の傾き (deg)。負 = 右上がり */
const PILLOW_TILT_DEG = -2;

/**
 * 座布団の紙めいた質感。fractalNoise を overlay で重ねる。SVG の data URI
 * にしているのは、座布団の色が盤ごとに変わるので画像を固定色で焼けないため。
 * overlay なら中間グレーが恒等になるので、明るい座布団でも暗い座布団でも
 * 粒が明暗の両側に散り、乗算のように色が濁って沈まない。
 */
const PILLOW_NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='96' height='96' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")";

/**
 * 座布団と曲名のフォント。ラテン文字は縦長 face、日本語は font-weight では
 * 届かない太さの face (どちらも globals.css) に載せ、無ければ通常の sans。
 */
const PILLOW_FONT = '"CondensedDisplay", "JapaneseDisplay", var(--font-sans)';

/**
 * 詳細表示のアクションボタン (歌詞 / 各サービス) の共通スタイル。
 * 3 つを 375px 幅で 1 行に収めるため、パディングとアイコン間隔を詰めてある
 * (合計 329px + 間隔 12px < 内容幅 343px)。それより狭い端末では
 * flex-wrap で 2 行に折れて、その分だけ盤が縮む。
 */
const DETAIL_ACTION_CLASS =
  "inline-flex h-9 items-center justify-center gap-1 rounded-full bg-zinc-100/80 px-2 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-200/85 active:bg-zinc-200/85 dark:bg-zinc-800/75 dark:text-zinc-200 dark:hover:bg-zinc-700/80 dark:active:bg-zinc-700/80";

/**
 * 詳細表示を切り替えるスワイプの最小縦移動量 (px)。評価ボタンのタップや
 * 指ブレで誤爆しないだけの距離を取る。横移動が縦移動を上回る間は無視する。
 */
const DETAIL_SWIPE_PX = 48;

/**
 * 詳細表示中の再生尺 (ms)。iTunes の試聴音源 1 本ぶん。この間はスニペットの
 * フェード / 曲送りを止めてカット無しで流し、流し切ったら盤ごと停止する。
 * 実際に鳴っている時の流し切り判定は音源の ended に任せるので、これは
 * 音が鳴らない時 (音源なし / 消音 / 自動再生ブロック中) の代替タイマー。
 */
const DETAIL_PLAY_MS = 30000;

/** 表示切替のトランジション。opacity を先に畳んでから高さを詰める */
const DETAIL_TRANSITION = {
  duration: 0.24,
  ease: "easeOut",
  opacity: { duration: 0.14 },
} as const;

/**
 * カルーセルの隣接ディスク間隔 (自身の幅に対する %)。
 * 100% 未満にして前後のディスクを画面端から覗かせ、カルーセルであることを
 * 見せる (scale 0.65 縮小と z-index 層で、現在の盤の後ろへ滑り込む)。
 */
const SLIDE_OFFSET_PERCENT = 80;

/**
 * 組カルーセルの間隔 (サムネイル幅に対する %)。中央から外側へ向かう
 * 区間ごとの間隔。急角度の背表紙は投影幅が細いので、棚の CD のように
 * 詰めて並ぶ間隔にしている (中央だけ正面向きのぶん広い)。
 */
const GROUP_THUMB_GAPS = [88, 54, 42, 38] as const;

/** 組サムネイルの中央からのオフセット (%)。区間幅を累積する */
function groupThumbOffset(delta: number): number {
  let x = 0;
  for (let i = 0; i < Math.abs(delta); i++) {
    x += GROUP_THUMB_GAPS[Math.min(i, GROUP_THUMB_GAPS.length - 1)];
  }
  return Math.sign(delta) * x;
}

/**
 * 組サムネイルの Y 軸傾き (deg)。再生中 (中央) だけ正面 (0°)、
 * それ以外は棚に並んだ CD のように背表紙 (側面) が主役になる急角度。
 */
const GROUP_THUMB_TILTS = [0, 60, 71, 80] as const;

/** 組サムネイルの厚み (px)。preserve-3d の側面としてレンダリングされる */
const GROUP_THUMB_DEPTH_PX = 8;

/** 組サムネイルの角丸 (px)。ほんの少しだけ丸める */
const GROUP_THUMB_RADIUS_PX = 2;

function groupThumbTilt(delta: number): number {
  const tilt =
    GROUP_THUMB_TILTS[Math.min(Math.abs(delta), GROUP_THUMB_TILTS.length - 1)];
  return -Math.sign(delta) * tilt;
}

/** デッキ内の現在位置。group = 組 (アーティスト)、song = 組内の曲順 */
interface DeckPosition {
  group: number;
  song: number;
}

/**
 * 次に再生される曲 (組の末尾からは次の組の先頭へ)。デッキの末尾では null。
 * クロスフェードは「次の曲」を先に鳴らし始める必要があるので、advance と
 * 同じ規則をここから引けるようにしてある。
 */
function nextSongOf(groups: Song[][], position: DeckPosition): Song | null {
  const group = groups[position.group];
  if (group && position.song + 1 < group.length) {
    return group[position.song + 1];
  }
  return groups[position.group + 1]?.[0] ?? null;
}

/**
 * 1 つ前の位置 (組の先頭からは前の組の末尾へ)。デッキの先頭にいる時だけ
 * null。自動送りで流れていった曲へ戻るために使う。
 */
function previousPositionOf(
  groups: Song[][],
  position: DeckPosition,
): DeckPosition | null {
  if (position.song > 0) {
    return { group: position.group, song: position.song - 1 };
  }
  const prev = groups[position.group - 1];
  if (!prev?.length) return null;
  return { group: position.group - 1, song: prev.length - 1 };
}

/** document.hidden の購読 (useSyncExternalStore 用。参照を固定するため外に置く) */
function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/**
 * 直前のユーザー操作。戻るボタンで取り消すために保持する。
 * rating が null の場合はナビゲーションのみ (組スキップ) で、
 * 位置の復元だけを行う。それ以外は DB 行も削除する。
 * これが無い (自動送りで進んだだけの) 時は、戻るボタンは位置を
 * 1 曲戻すだけの移動になる。
 */
interface LastAction {
  position: DeckPosition;
  song: Song;
  rating: Rating | null;
}

const RATINGS: ReadonlyArray<{
  value: Rating;
  label: string;
  Icon: typeof X;
  /** 枠線・記号・塗り・火花に共通で使う評価色 (濃淡 3 段) */
  hue: string;
  light: string;
  dark: string;
  /** 塗り終わりの記号色。黄だけ白では読めないので濃茶にする */
  onGlyph: string;
  /** 「太いペンで塗った」塗りつぶし。評価ごとに固定 (毎回同じ跡になる) */
  fill: MarkerFill;
}> = [
  {
    value: "hard",
    label: "苦手",
    Icon: X,
    hue: "#ef4444",
    light: "#f87171",
    dark: "#b91c1c",
    onGlyph: "#fff",
    fill: buildMarkerFill("hard"),
  },
  {
    value: "medium",
    label: "普通",
    Icon: Minus,
    hue: "#eab308",
    light: "#fcd34d",
    dark: "#a16207",
    onGlyph: "#3f2d05",
    fill: buildMarkerFill("medium"),
  },
  {
    value: "easy",
    label: "得意",
    Icon: Check,
    hue: "#10b981",
    light: "#34d399",
    dark: "#047857",
    onGlyph: "#fff",
    fill: buildMarkerFill("easy"),
  },
  {
    value: "practicing",
    label: "練習中",
    Icon: DumbbellMini,
    hue: "#a855f7",
    light: "#c084fc",
    dark: "#7e22ce",
    onGlyph: "#fff",
    fill: buildMarkerFill("practicing"),
  },
];

/** 塗りを見せておく時間 (ms)。評価するとすぐ次の曲へ進むので、余韻の分だけ */
const RATING_FLASH_MS = 900;

/**
 * 塗りの層。太いペンの線を上から順に伸ばし、塗ってよい範囲で切る。
 * 枠線を持つボタン (評価 / スキップ / 戻る) で共有する。
 */
function MarkerInk({
  fill,
  filled,
  clipId,
  color,
}: {
  fill: MarkerFill;
  filled: boolean;
  clipId: string;
  color: string;
}) {
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <path d={fill.area} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} opacity={0.98}>
        <g
          transform={`rotate(${fill.tiltDeg} ${fill.width / 2} ${fill.height / 2})`}
        >
          {fill.strokes.map((d, i) => (
            <path
              key={i}
              className="rating-ink"
              d={d}
              pathLength={1}
              stroke={color}
              strokeWidth={fill.penWidth}
              strokeLinecap="round"
              fill="none"
              style={{ transitionDelay: `${i * 46}ms` }}
              data-filled={filled ? "" : undefined}
            />
          ))}
        </g>
      </g>
    </>
  );
}

/**
 * 評価ボタン。押していない間は枠線だけで、押すと中が太いペンで塗られる。
 * 塗りは上から順に 1 本ずつ、少し傾けて引く (marker-fill.ts)。
 */
function RatingKnob({
  rating,
  filled,
}: {
  rating: (typeof RATINGS)[number];
  filled: boolean;
}) {
  return (
    <span className="relative block size-14">
      <svg viewBox="0 0 56 56" className="block size-full" aria-hidden>
        <MarkerInk
          fill={rating.fill}
          filled={filled}
          clipId={`rating-fill-${rating.value}`}
          color={rating.hue}
        />
        <circle
          cx="28"
          cy="28"
          r="25"
          fill="none"
          stroke={rating.hue}
          strokeWidth="2"
        />
        {/* 記号は 24 単位の入れ子 SVG。幅高を明示しておく (省略すると
            入れ子 SVG は親のビューポート全体に広がってしまう) */}
        <g
          transform="translate(16 16)"
          className="rating-glyph"
          style={{ color: filled ? rating.onGlyph : rating.hue }}
        >
          <rating.Icon width={24} height={24} />
        </g>
      </svg>
    </span>
  );
}

/**
 * スキップ / 戻る用の枠線と塗り。
 *
 * 色はラベルとは別にグレー (zinc-700) で持つ。評価ボタンが 4 色で主張する
 * 行なので、ここは白ではなく暗い灰色に落として脇役に置く。塗りも同じ色に
 * なるので、塗られている間はラベル側を明るく反転させる (呼び出し側)。
 *
 * ピル型は幅が端末で変わるため、呼び出し側が実寸を測って fill を組む。
 */
function MarkerSurface({
  fill,
  filled,
  id,
}: {
  fill: MarkerFill | null;
  filled: boolean;
  id: string;
}) {
  if (!fill) return null;
  const inset = 1;
  return (
    <svg
      viewBox={`0 0 ${fill.width} ${fill.height}`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 size-full text-zinc-700"
      aria-hidden
    >
      <MarkerInk
        fill={fill}
        filled={filled}
        clipId={`action-fill-${id}`}
        color="currentColor"
      />
      <rect
        x={inset}
        y={inset}
        width={fill.width - inset * 2}
        height={fill.height - inset * 2}
        rx={(fill.height - inset * 2) / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

/** 要素の実寸 (幅) を測る。2px 刻みに丸めて塗りの組み直しを抑える */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setWidth(Math.round(w / 2) * 2);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

interface RecordDeckProps {
  /** 組 (同一アーティストの楽曲群) の配列。各組は [推薦シード, ...人気順] */
  initialGroups: Song[][];
  /**
   * cookie に保存すべきデッキトークン。保存済みの内容と同じなら null。
   * Server Component からは cookie を書けないので、マウント後に
   * /api/deck へ POST して保存する (次に開いた時に同じデッキが復元される)。
   */
  persistToken: string | null;
}

export function RecordDeck({ initialGroups, persistToken }: RecordDeckProps) {
  const pathname = usePathname();
  // ゲスト (未ログイン) はデッキが固定 70 曲の中の 10 組なので、
  // 引き直し先が無い。評価の保存先も localStorage に変わる。
  const isGuest = useIsGuest();
  const { rateSong, unrateSong, markSkipped } = useRatingActions();
  // RecordDeck はホーム (/) でのみマウントされるので、マウントされたまま
  // pathname が /songs/[id] になっていれば、楽曲ページ/シートが上に
  // 開いている (intercepting route) と判定できる。
  const sheetOpen = /^\/songs\/[^/]+\/?$/.test(pathname);
  // サーバーから渡された組は初期値としてだけ使う (シャッフル以外では
  // 差し替えない)。評価のたびに走る revalidatePath でホームが再レンダー
  // されても、表示中のデッキはそのまま維持される。
  const [groups, setGroups] = useState(initialGroups);
  const [position, setPosition] = useState<DeckPosition>({ group: 0, song: 0 });
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 今しがた押された評価。押したボタンだけを一瞬塗り、余韻を過ぎたら戻す。
  const [flashRating, setFlashRating] = useState<Rating | null>(null);
  // スキップ / 戻るも押した瞬間だけ塗る (粒は飛ばさない)
  const [flashAction, setFlashAction] = useState<
    "skip-song" | "skip-group" | "back" | null
  >(null);
  // ピル型 2 つは同じ幅なので、片方を測って両方に使う
  const [skipRef, skipWidth] = useElementWidth<HTMLButtonElement>();
  const [shuffling, setShuffling] = useState(false);
  // 上スワイプで入る擬似的な楽曲詳細表示。組カルーセル / スキップ行 /
  // シャッフルを畳み、代わりに楽曲情報と歌詞ボタンを出す (下スワイプで戻る)。
  // この間は自動送りを止め、試聴を 30 秒フルで流す。
  // state をレイアウト側に置いてあるのは、兄弟のボトムナビも引っ込めるため。
  const { detailOpen: detail, setDetailOpen: setDetail } = useDeckDetail();
  // 詳細表示で 30 秒を流し切った曲の id。曲を替えれば自動的に外れるので、
  // 「今の曲が流し終わったか」は下で id を突き合わせて導出する。
  const [detailPlayedOut, setDetailPlayedOut] = useState<string | null>(null);
  // タブ / アプリがバックグラウンドに回っているか。この間は試聴だけでなく
  // 尺のタイマーも止める。裏で数え続けると、戻ってきた時に見ていない曲が
  // 何曲も送られた後になってしまう。裏のタブで開かれた場合は最初の
  // visibilitychange が「表に出た時」まで来ないので、初期値も document から
  // 直接読む (サーバーでは常に false = 表示中として描く)。
  const backgrounded = useSyncExternalStore(
    subscribeVisibility,
    () => document.hidden,
    () => false,
  );
  // 進行中のスワイプの起点。pointerId で 1 本目の指だけを追う。
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);
  // 試聴 ON/OFF (ユーザーの意思)。デフォルト ON。ON でも音源が無い曲は
  // 無音で回る。ブラウザに自動再生をブロックされた場合は
  // needsGestureRetryRef を立て、最初の画面操作で再生を再試行する。
  const [audioOn, setAudioOn] = useState(true);
  // 実際に音を出せる状態か (自動再生ブロックが解除済みか)。意思 (audioOn)
  // とは別に持ち、「ON のつもりだがブロックで鳴っていない」間は消音アイコン
  // を見せて実態と一致させる。play() の成否で needsGestureRetryRef と
  // 同時に更新される (ref はリスナー用の同期値、これは表示用)。
  const [audioBlocked, setAudioBlocked] = useState(true);
  // 試聴プレイヤー 2 台と、今どちらが現役か。片方が鳴っている間にもう
  // 片方が次の曲を読み込み、切り替えでは 2 台を重ねてクロスフェードする。
  // 要素を作り直さず使い回すのは、iOS が「ユーザー操作中に play() した
  // 要素」しか以後のプログラム再生を許さないため (アンロック済みの要素を
  // 捨てると、次の曲から鳴らなくなる)。
  const playersRef = useRef<SnippetPlayer[] | null>(null);
  const activeRef = useRef(0);
  // 2 台の後ろに置く共通の音量。評価時の一瞬の絞り込みはここだけ動かすので、
  // 各プレイヤーのクロスフェード (個別 gain) と干渉しない。
  const masterGainRef = useRef<GainNode | null>(null);
  // 2 台とも一度はユーザー操作の文脈で play() したか (iOS のアンロック)。
  const unlockedRef = useRef(false);
  // 現役プレイヤーに載っている曲 id。タップ起点の再生と曲送り effect の
  // 二重再生を防ぐほか、クロスフェードで先に切り替わっている時の目印になる。
  const playingSongIdRef = useRef<string | null>(null);
  // 現役に載っているのが実際の試聴音源か (アンロック用の無音 WAV でないか)。
  // 無音 WAV は即 ended が飛ぶので、そこで曲送りしないための印。
  const previewPlayingRef = useRef(false);
  // 音源を最後まで流し切った時の処理。要素の生成時にリスナーを張るが、
  // 中身は毎レンダー差し替えて最新の state を見せる。降りた側 (フェード
  // アウト中) の ended と区別するため、発火元の要素を受け取る。
  const onAudioEndedRef = useRef<(el: HTMLAudioElement) => void>(() => {});
  // 初期値 true: マウント直後の play() の reject が届く前の素早いタップでも
  // ジェスチャ再試行が動くようにする (鳴っていれば再試行側の guard が弾く)。
  const needsGestureRetryRef = useRef(true);

  const group = groups[position.group];
  const current = group?.[position.song];
  // 戻るボタンの行き先。デッキの先頭にいる時だけ null (= 押せない)。
  const previousPosition = previousPositionOf(groups, position);

  // スキップ / 戻るの塗り。幅が確定するまでは枠も塗りも出さない
  // (0 幅で組むと形が壊れるため)。高さは 3.5rem 固定。
  const skipSongFill = useMemo(
    () =>
      skipWidth > 0
        ? buildMarkerFill("skip-song", { width: skipWidth, height: 56 })
        : null,
    [skipWidth],
  );
  const skipGroupFill = useMemo(
    () =>
      skipWidth > 0
        ? buildMarkerFill("skip-group", { width: skipWidth, height: 56 })
        : null,
    [skipWidth],
  );
  const backFill = useMemo(() => buildMarkerFill("back"), []);

  /** スキップ / 戻るの塗りを一瞬だけ見せる */
  const flashActionButton = useCallback(
    (key: "skip-song" | "skip-group" | "back") => {
      setFlashAction(key);
      window.setTimeout(() => {
        setFlashAction((now) => (now === key ? null : now));
      }, RATING_FLASH_MS);
    },
    [],
  );

  // アーティスト名の枕は「1 枚目のレコード」の代表色の反対色。組が
  // 変わると 1 枚目も変わるので、組の先頭曲のジャケットから引く。
  const groupSeed = group?.[0];
  const pillow = pillowColorOf(
    useVinylColor(
      groupSeed?.image_url_large ?? groupSeed?.image_url_medium ?? null,
    ),
  );

  // AnimatePresence の退場ツリー (組遷移中 0.2 秒残る) のボタンは古い
  // props を凍結したままタップできてしまう。ハンドラが常に実状態で動ける
  // よう、最新の current / audioOn / detail をコミット後に ref へ同期しておく。
  const currentRef = useRef(current);
  const audioOnRef = useRef(audioOn);
  const detailRef = useRef(detail);
  useEffect(() => {
    currentRef.current = current;
    audioOnRef.current = audioOn;
    detailRef.current = detail;
  });

  // 新しく組まれたデッキを cookie に保存する (レンダー中は cookie を
  // 書けないのでここから)。保存済みと同じ内容なら persistToken は null。
  // 失敗しても表示中のデッキには影響しない (次回開いた時に組み直しになるだけ)。
  // keepalive: 表示直後にタブを切り替えられてもこの保存だけは完了させる
  // (ここで取りこぼすと、まさに切り替え先から戻った時に組み直しになる)。
  useEffect(() => {
    if (!persistToken) return;
    void fetch("/api/deck", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: persistToken }),
      keepalive: true,
    }).catch(() => {});
  }, [persistToken]);

  // ホームにいる間は body スクロールをロック (回転中の誤スクロール防止)。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // 詳細表示の state はレイアウト側に置いてあるので、ホームを離れる時に
  // 自分で畳んでおく (放置するとナビが引っ込んだままの画面へ移動する)。
  useEffect(() => {
    return () => setDetail(false);
  }, [setDetail]);

  /** 2 台のプレイヤーを遅延生成し、Web Audio の gain 経由でつなぐ */
  const ensurePlayers = useCallback((): SnippetPlayer[] => {
    if (playersRef.current) return playersRef.current;
    const ctx = getAudioContext();
    let master: GainNode | null = null;
    if (ctx) {
      try {
        master = ctx.createGain();
        master.connect(ctx.destination);
      } catch {
        master = null;
      }
    }
    masterGainRef.current = master;
    const create = (): SnippetPlayer => {
      const el = new Audio();
      el.preload = "auto";
      // Web Audio へ流すには CORS 許可が要る (無いとグラフの出力が無音に
      // なる)。iTunes のプレビューは ACAO: * を返すので通る。
      el.crossOrigin = "anonymous";
      let gain: GainNode | null = null;
      if (ctx) {
        try {
          gain = ctx.createGain();
          ctx
            .createMediaElementSource(el)
            .connect(gain)
            .connect(master ?? ctx.destination);
        } catch {
          // Web Audio が使えない環境は要素の volume にフォールバックする
          // (= iOS Safari 以外ではフェード無しの切り替えになる)
          gain = null;
        }
      }
      el.addEventListener("ended", () => onAudioEndedRef.current(el));
      return { el, gain };
    };
    playersRef.current = [create(), create()];
    return playersRef.current;
  }, []);

  /**
   * 音量を value へ動かす。ms > 0 なら線形に。
   * gain が無い環境ではフェードを表現できないので、フェードアウトだけは
   * 何もせず (鳴らしたまま最後に pause される)、それ以外は即時反映する。
   */
  const rampGain = useCallback(
    (player: SnippetPlayer, value: number, ms: number) => {
      const ctx = getAudioContext();
      if (player.gain && ctx) {
        const param = player.gain.gain;
        const now = ctx.currentTime;
        param.cancelScheduledValues(now);
        param.setValueAtTime(param.value, now);
        if (ms > 0) param.linearRampToValueAtTime(value, now + ms / 1000);
        else param.setValueAtTime(value, now);
        return;
      }
      if (ms > 0 && value === 0) return;
      try {
        player.el.volume = value;
      } catch {
        /* iOS Safari は volume 変更不可 */
      }
    },
    [],
  );

  /**
   * 評価音を聞かせるために試聴を一瞬だけ絞る。グラフを通せない環境
   * (Web Audio 無し) では何もしない。要素の volume は iOS で動かせず、
   * 絞ったまま戻らない事故の方が高くつく。
   */
  const duckPreview = useCallback(() => {
    const ctx = getAudioContext();
    const master = masterGainRef.current;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const g = master.gain;
    const holdUntil = now + DUCK_ATTACK_S + DUCK_HOLD_S;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(DUCK_LEVEL, now + DUCK_ATTACK_S);
    g.setValueAtTime(DUCK_LEVEL, holdUntil);
    g.linearRampToValueAtTime(1, holdUntil + DUCK_RELEASE_S);
  }, []);

  /** 今の再生が実際に聞こえる状態か (グラフ経由なら context 次第) */
  const markPlaybackStarted = useCallback((player: SnippetPlayer) => {
    const audible = !player.gain || isAudioContextRunning();
    needsGestureRetryRef.current = !audible;
    setAudioBlocked(!audible);
  }, []);

  /**
   * iOS は「ユーザー操作中に play() した要素」しか以後のプログラム再生を
   * 許さない。クロスフェードは 2 台目を裏で鳴らし始めるので、最初の操作で
   * 両方アンロックしておく (鳴っていない側は無音 WAV を一瞬鳴らす)。
   */
  const unlockPlayers = useCallback(() => {
    if (unlockedRef.current) return;
    unlockedRef.current = true;
    for (const player of ensurePlayers()) {
      if (!player.el.paused) continue;
      player.el.src = SILENT_WAV;
      void player.el.play().then(
        () => player.el.pause(),
        () => {},
      );
    }
  }, [ensurePlayers]);

  /** 次の曲を待機側へ読み込ませておく (クロスフェードで即座に立ち上がる) */
  const prefetchSong = useCallback(
    (song: Song | null) => {
      const src = song?.itunes_preview_url;
      if (!src || !audioOnRef.current) return;
      const standby = ensurePlayers()[1 - activeRef.current];
      if (standby.el.src === src) return;
      standby.el.src = src;
    },
    [ensurePlayers],
  );

  /**
   * song へ切り替える。今鳴っている側を fadeMs かけて落としながら、待機側で
   * song を頭から立ち上げる。song が null なら落とすだけ。待機側に先読み
   * 済みなら src はそのまま使うので、切り替えは待たされない。
   */
  const crossfadeTo = useCallback(
    (song: Song | null, fadeMs: number) => {
      const players = ensurePlayers();
      const outgoing = players[activeRef.current];
      const incoming = players[1 - activeRef.current];

      // 降りる側: 落とし切ってから止める (先に止めると音が途切れる)
      rampGain(outgoing, 0, fadeMs);
      const outgoingEl = outgoing.el;
      window.setTimeout(() => {
        // フェード中にこの要素が現役へ戻っていたら止めない
        if (playersRef.current?.[activeRef.current].el === outgoingEl) return;
        outgoingEl.pause();
      }, fadeMs);

      activeRef.current = 1 - activeRef.current;
      playingSongIdRef.current = song?.id ?? null;
      const src = song?.itunes_preview_url ?? null;
      previewPlayingRef.current = Boolean(src);
      if (!src) {
        incoming.el.pause();
        return;
      }
      // 先読み済みなら再代入しない (読み直しになる)
      if (incoming.el.src !== src) incoming.el.src = src;
      try {
        incoming.el.currentTime = 0;
      } catch {
        /* メタデータ未読込。読み込み後に頭から始まる */
      }
      rampGain(incoming, 0, 0);
      rampGain(incoming, 1, fadeMs);
      void incoming.el.play().then(
        () => markPlaybackStarted(incoming),
        (err: unknown) => {
          // pause() や src 差し替えによる自己中断 (AbortError) は正常系なので
          // 無視する。自動再生ブロック (NotAllowedError) の時だけ、次の
          // ユーザー操作 (ジェスチャ文脈) での再試行を予約する。
          if ((err as DOMException)?.name === "NotAllowedError") {
            needsGestureRetryRef.current = true;
            setAudioBlocked(true);
          }
        },
      );
    },
    [ensurePlayers, rampGain, markPlaybackStarted],
  );

  // 自動再生がブロックされた場合の復帰: 最初の画面操作 (どこでも) の
  // ジェスチャ文脈内で play() し直す。iOS Safari は touchstart 相当
  // (pointerdown) の間はメディア再生を許可しないため、活性化が期待できる
  // pointerup と click の両方で試みる。フラグはここでは下ろさず、再生
  // 成功時に crossfadeTo 側で下ろす (先に下ろすと、失敗の非同期 reject が
  // click 通過後にフラグを立て直し、何度タップしても鳴らないループになる)。
  // pointerup と click が連続して二重に走った場合は、src の差し替えが
  // 先行の play() を AbortError (無視される正常系) で打ち切るだけで無害。
  useEffect(() => {
    const retryOnGesture = () => {
      // AudioContext はユーザー操作の文脈でしか resume できない。鳴って
      // いるかに関わらず、触られたら起こしておく (グラフ経由の音は
      // context が suspended だと play() が成功しても無音になる)。
      resumeAudioContext();
      if (!needsGestureRetryRef.current || !audioOnRef.current) return;
      const song = currentRef.current;
      if (!song) return;
      unlockPlayers();
      const active = ensurePlayers()[activeRef.current];
      // 既に現在の曲が鳴っているなら (stale フラグ) 頭出しし直さない
      if (playingSongIdRef.current === song.id && !active.el.paused) {
        markPlaybackStarted(active);
        return;
      }
      // 音源が無い曲でも unlockPlayers が要素を起こしてあるので、以後の
      // 曲送り (音源のある曲) はプログラム再生で通る
      crossfadeTo(song, 0);
    };
    document.addEventListener("pointerup", retryOnGesture, true);
    document.addEventListener("click", retryOnGesture, true);
    return () => {
      document.removeEventListener("pointerup", retryOnGesture, true);
      document.removeEventListener("click", retryOnGesture, true);
    };
  }, [crossfadeTo, ensurePlayers, markPlaybackStarted, unlockPlayers]);

  // 楽曲シート (リンクで /songs/[id] がホームの上に開いた状態) と詳細表示の
  // 開閉に合わせてフル尺モードへ入る。ここでは再生に手を触れない。頭出しし
  // 直すと開閉のたびに音が最初へ戻ってしまうので、鳴っている音はそのまま
  // 流し続ける。曲送りとクロスフェードは下のタイマーが握っており、フル尺
  // モードの間は張られないので、開いている間に曲が変わることもない。
  const fullPlayback = sheetOpen || detail;
  useEffect(() => {
    const players = playersRef.current;
    if (!players) return;
    // クロスフェードの途中で開かれた場合に備えて、現役側を最大へ戻す
    rampGain(players[activeRef.current], 1, 0);
  }, [fullPlayback, rampGain]);

  // 曲が変わったら試聴を切り替える。自動送りでは尺の終わりに始まった
  // クロスフェードで既に切り替わっているので、その時はここは何もしない
  // (playingSongIdRef が先に次の曲を指している)。評価やスキップで送られた
  // 場合だけ、ここから短いクロスフェードで追いつく。
  // デフォルト ON なので初回マウントでもここから再生を試みる
  // (ブロックされたら上のジェスチャ再試行に委ねる)。
  useEffect(() => {
    if (!audioOn) return;
    if (!current) {
      for (const player of ensurePlayers()) player.el.pause();
      playingSongIdRef.current = null;
      return;
    }
    if (playingSongIdRef.current === current.id) return;
    crossfadeTo(current, CROSSFADE_TAP_MS);
  }, [audioOn, current, crossfadeTo, ensurePlayers]);

  // 詳細表示で試聴を流し切ったら、盤を止めて無音のままにする。鳴っている
  // 時は音源の ended が正確なので、ここでタイマーを張るのは「そもそも音が
  // 鳴らない」時だけ (音源なし / 消音中 / 自動再生ブロック中)。
  const currentId = current?.id;
  const willPlayPreview =
    audioOn && !audioBlocked && Boolean(current?.itunes_preview_url);
  useEffect(() => {
    if (!detail || !currentId || willPlayPreview || backgrounded) return;
    const timer = window.setTimeout(() => {
      setDetailPlayedOut(currentId);
      playersRef.current?.[activeRef.current].el.pause();
    }, DETAIL_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [detail, currentId, willPlayPreview, backgrounded]);

  // 似た音域の楽曲。詳細を開いている曲のぶんだけ取りに行き、曲 id で
  // キャッシュする (曲送りで開き直しても取り直さない)。
  const [similarBySong, setSimilarBySong] = useState<
    Record<string, SimilarSong[]>
  >({});
  // 取得を投げた曲 id。effect の依存に state を入れずに二重取得を防ぐ。
  const similarRequestedRef = useRef(new Set<string>());
  const similarSongs = currentId ? similarBySong[currentId] : undefined;

  useEffect(() => {
    if (!detail || !currentId) return;
    if (similarRequestedRef.current.has(currentId)) return;
    similarRequestedRef.current.add(currentId);
    let cancelled = false;
    void getSimilarSongs(currentId).then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          // 失敗した曲は投げ直せるようにしておく (次に開いた時に再挑戦)
          similarRequestedRef.current.delete(currentId);
          return;
        }
        setSimilarBySong((prev) => ({
          ...prev,
          [currentId]: result.songs ?? [],
        }));
      },
      () => {
        if (!cancelled) similarRequestedRef.current.delete(currentId);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [detail, currentId]);

  // 流し切った判定は「詳細表示中で、かつ今の曲が流し終わっている」時だけ。
  // 曲送りでも詳細を抜けても勝手に外れるので、明示的なリセットは詳細に
  // 入り直す時 (toggleDetail) の 1 箇所だけで足りる。
  const detailEnded = detail && detailPlayedOut === currentId;

  // バックグラウンドでは試聴を止める。Android は放置すると裏で音が流れ
  // 続け、iOS は OS に止められた後で無音のままになるため、復帰時は
  // 現在の曲を頭から再生し直す (回転は次の周回で自然に再同期する)。
  // 曲送りの方は backgrounded を見るスニペットのタイマー側で止まる。
  useEffect(() => {
    const onVisibility = () => {
      const players = playersRef.current;
      if (!players) return;
      if (document.hidden) {
        for (const player of players) player.el.pause();
      } else if (audioOn && current) {
        crossfadeTo(current, CROSSFADE_TAP_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [audioOn, current, crossfadeTo]);

  // アンマウント時に音を止める
  useEffect(() => {
    return () => {
      for (const player of playersRef.current ?? []) player.el.pause();
    };
  }, []);

  /**
   * 音量ボタンで試聴の再生/停止を切り替える。
   * iOS Safari はユーザー操作中に play() した要素しか以後のプログラム再生を
   * 許さないため、初回タップでは必ずこのハンドラ内 (ジェスチャ文脈) で
   * play() を呼ぶ。音源が無い曲でも無音 WAV でアンロックしておく。
   * 分岐は「タップ時にアイコンが何を見せていたか」= 描画済み state で決める
   * (このボタンは AnimatePresence の外なので closure は常に最新)。ブロック中
   * (意思 ON だが無音 = 消音アイコン表示) のタップを ref の生値で判定すると、
   * 直前に走る画面タップ復帰 (retryOnGesture) との競争で停止/再生が
   * 不安定になる。見えていたアイコンの意味どおりに動かす。
   */
  const handleToggleAudio = () => {
    const song = currentRef.current;
    if (!song) return;
    triggerHaptic();
    resumeAudioContext();
    if (audioOn && !audioBlocked) {
      for (const player of ensurePlayers()) player.el.pause();
      playingSongIdRef.current = null;
      setAudioOn(false);
      return;
    }
    setAudioOn(true);
    // アンロックは crossfadeTo より先に済ませる (2 台目をこの操作の文脈で
    // 起こしておかないと、次の曲のクロスフェードが iOS で鳴らない)
    unlockPlayers();
    crossfadeTo(song, CROSSFADE_TAP_MS);
  };

  /**
   * from の次の曲 (組の末尾なら次の組の先頭) へ進む。
   * 現在位置が from と一致する時だけ進めることで、組スキップ / undo と
   * スニペットのタイマーや音源の ended が競合した時の上書きを防ぐ。
   */
  const advance = useCallback(
    (from: DeckPosition) => {
      setPosition((p) => {
        if (p.group !== from.group || p.song !== from.song) return p;
        const g = groups[from.group];
        return g && from.song + 1 < g.length
          ? { group: from.group, song: from.song + 1 }
          : { group: from.group + 1, song: 0 };
      });
    },
    [groups],
  );

  // スニペットの尺ごとの曲送り。以前は盤の回転 (animationiteration) が発火させていたが、
  // それだと「回転の位相 = 音源の再生位置」を保つために、詳細表示を閉じる
  // たびに音を頭出しする必要があった。タイマーに移したことで回転は見た目
  // だけの存在になり、角度が何度であっても音の連続性に影響しない。
  // フル尺モード (詳細表示 / 楽曲シート) の間は張らない = 自動送りも止まる。
  // バックグラウンドの間も同様に張らない。裏でも数え続けると、他のアプリを
  // 触っている間にデッキだけが進み (Android では次の曲の再生まで始まり)、
  // 戻ってきた時に聴いていない曲が評価対象から流れてしまう。復帰時はここが
  // 張り直されるので、その曲の 10 秒はまた頭から数え直しになる。
  // 同じタイマーで、尺の終わり CROSSFADE_AUTO_MS 前に次の曲を重ね始める
  // (表示が切り替わる前に次の曲が鳴り始めるのがクロスフェード)。次の曲の
  // 読み込みはその手前で済ませておく。開始を CROSSFADE_AUTO_MS + 0.5 秒に
  // しているのは、現在の曲の取得 (実測 1 秒弱) と重ねないため。
  useEffect(() => {
    if (fullPlayback || backgrounded || !current) return;
    const next = nextSongOf(groups, position);
    const prefetchTimer = window.setTimeout(
      () => prefetchSong(next),
      CROSSFADE_AUTO_MS + 500,
    );
    const crossfadeTimer = window.setTimeout(() => {
      if (audioOnRef.current) crossfadeTo(next, CROSSFADE_AUTO_MS);
    }, SNIPPET_MS - CROSSFADE_AUTO_MS);
    const advanceTimer = window.setTimeout(() => advance(position), SNIPPET_MS);
    return () => {
      window.clearTimeout(prefetchTimer);
      window.clearTimeout(crossfadeTimer);
      window.clearTimeout(advanceTimer);
    };
  }, [
    fullPlayback,
    backgrounded,
    current,
    position,
    groups,
    advance,
    crossfadeTo,
    prefetchSong,
  ]);

  // 音源を最後まで流し切った時。詳細表示中なら盤を止めて無音のまま待ち、
  // 通常の周回中なら次の曲へ送る (詳細表示から音源の終盤で戻ってきた時、
  // スニペットのタイマーより先に音源が尽きるケース)。
  useEffect(() => {
    onAudioEndedRef.current = (el) => {
      // アンロック用の無音 WAV の ended は無視する (即座に飛んでくる)
      if (!previewPlayingRef.current) return;
      // クロスフェードで降りた側の ended は現役の周回に関係ない
      if (playersRef.current?.[activeRef.current].el !== el) return;
      if (detailRef.current) {
        if (currentRef.current) setDetailPlayedOut(currentRef.current.id);
        return;
      }
      // 楽曲シート表示中はページ側のフル尺再生なので、送らずに止まる
      if (sheetOpen) return;
      advance(position);
    };
  });

  const handleRate = (rating: Rating, button?: HTMLElement) => {
    if (!current) return;
    triggerHaptic();
    triggerRatingSound(rating);
    duckPreview();
    // 押したボタンの中心から火花を飛ばす。塗りはこの間に描かれる。
    const spec = RATINGS.find((r) => r.value === rating);
    if (button && spec) {
      const box = button.getBoundingClientRect();
      emitSparks(box.left + box.width / 2, box.top + 28, [
        spec.light,
        spec.hue,
        spec.dark,
      ]);
    }
    setFlashRating(rating);
    window.setTimeout(() => {
      setFlashRating((current) => (current === rating ? null : current));
    }, RATING_FLASH_MS);
    setError(null);
    const action: LastAction = { position, song: current, rating };
    setLastAction(action);
    advance(position);
    startTransition(async () => {
      const result = await rateSong({ songId: action.song.id, rating });
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        // 失敗した action 自身の undo だけ無効化する (後続操作の undo は保持)
        setLastAction((la) => (la === action ? null : la));
      }
    });
  };

  const handleSkipSong = () => {
    if (!current) return;
    triggerHaptic();
    flashActionButton("skip-song");
    setError(null);
    const action: LastAction = { position, song: current, rating: "skip" };
    setLastAction(action);
    advance(position);
    startTransition(async () => {
      const result = await markSkipped(action.song.id);
      if (!result.ok) {
        setError(result.error ?? "スキップの保存に失敗しました");
        setLastAction((la) => (la === action ? null : la));
      }
    });
  };

  // 組スキップは「今は聴きたくない」ナビゲーションであり評価ではないので、
  // DB には何も書かない (未視聴の曲を skip 扱いで潰さない)。
  const handleSkipGroup = () => {
    if (!current) return;
    triggerHaptic();
    flashActionButton("skip-group");
    setError(null);
    setLastAction({ position, song: current, rating: null });
    setPosition({ group: position.group + 1, song: 0 });
  };

  /**
   * デッキを引き直す。推薦が入れ替わるのは基本ここだけ (あとは TTL 経過)。
   * サーバー側で cookie も更新されるので、次にホームを開いた時もこの
   * デッキが復元される。
   */
  const handleShuffle = () => {
    if (shuffling) return;
    triggerHaptic();
    setError(null);

    // ゲストのデッキは固定 10 組なので引き直す先が無い。未評価で残っている
    // 組を並べ替え、先頭から見せ直す (評価済みはここで落とす)。
    if (isGuest) {
      const rated = new Set(Object.keys(readGuestRatings()));
      setGroups((current) =>
        shuffleGroups(filterUnratedGroups(current, rated)),
      );
      setPosition({ group: 0, song: 0 });
      setLastAction(null);
      return;
    }

    setShuffling(true);
    startTransition(async () => {
      const result = await shuffleDeck();
      setShuffling(false);
      if (!result.ok || !result.groups) {
        setError(result.error ?? "シャッフルに失敗しました");
        return;
      }
      setGroups(result.groups);
      setPosition({ group: 0, song: 0 });
      setLastAction(null);
    });
  };

  /**
   * 1 つ前へ戻る。直前が評価 / スキップならそれを取り消して戻り、
   * 自動送りで流れただけなら位置を 1 曲戻す (評価は付いていないので
   * 取り消すものが無い)。押し続ければデッキの先頭まで遡れる。
   */
  const handleBack = () => {
    if (lastAction) {
      triggerHaptic();
      flashActionButton("back");
      setError(null);
      const { position: prevPosition, song, rating } = lastAction;
      setLastAction(null);
      setPosition(prevPosition);
      if (rating === null) return;
      startTransition(async () => {
        const result = await unrateSong(song.id);
        if (!result.ok) {
          setError(result.error ?? "戻す操作に失敗しました");
        }
      });
      return;
    }
    if (!previousPosition) return;
    triggerHaptic();
    flashActionButton("back");
    setError(null);
    // 連打で 2 曲飛ばないよう、行き先はレンダー時の値ではなく
    // 更新時点の位置から引き直す。
    setPosition((p) => previousPositionOf(groups, p) ?? p);
  };

  const toggleDetail = (next: boolean) => {
    if (next === detail) return;
    triggerHaptic();
    setDetail(next);
    // 同じ曲で入り直した時に「もう流し終わっている」扱いにしない
    if (next) {
      setDetailPlayedOut(null);
      return;
    }
    // 流し切った曲は音源が終端にいるので、閉じても鳴らせない。無音で
    // 待たせる意味は無いので、その時だけ閉じると同時に次の曲へ送る。
    if (current && detailPlayedOut === current.id) advance(position);
  };

  /**
   * デッキ全体の縦スワイプで詳細表示を出し入れする。
   * ハンドラは root に置いてあるので、ディスクでもボタンの上でも拾える。
   * 判定を満たした時点で起点を捨て、1 ジェスチャで 1 回だけ切り替える。
   */
  const handleSwipeStart = (event: React.PointerEvent) => {
    swipeRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  };

  const handleSwipeMove = (event: React.PointerEvent) => {
    const start = swipeRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dy = event.clientY - start.y;
    const dx = event.clientX - start.x;
    // 横に流れているスワイプ (カルーセル的な操作) では切り替えない
    if (Math.abs(dy) < DETAIL_SWIPE_PX || Math.abs(dy) <= Math.abs(dx)) return;
    swipeRef.current = null;
    // 上スワイプ (dy < 0) で詳細を引き上げ、下スワイプで元に戻す
    toggleDetail(dy < 0);
  };

  const handleSwipeEnd = () => {
    swipeRef.current = null;
  };

  if (!current) {
    // ゲストは残りの組が無くなったら引き直す先が無い (お試しの 10 組で
    // 打ち止め)。ここが一番ログインの動機が立つ場面なので導線を出す。
    const guestExhausted = isGuest && groups.length === 0;
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">
          {guestExhausted
            ? "お試しの曲をすべて評価しました 🎉"
            : "このデッキは終了しました 🎉"}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {guestExhausted
            ? "ログインすると全曲から評価でき、評価した履歴も残ります。"
            : "「次のデッキへ」で新しい組を引き直せます。"}
        </p>
        {guestExhausted ? (
          <Link
            href="/login?next=/"
            className={buttonVariants({
              size: "lg",
              className: "h-14 px-8 text-lg font-bold",
            })}
          >
            ログインする
          </Link>
        ) : (
          <Button
            onClick={handleShuffle}
            disabled={shuffling}
            size="lg"
            className="h-14 px-8 text-lg font-bold"
          >
            次のデッキへ
          </Button>
        )}
        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    );
  }

  const nextGroup = groups[position.group + 1];

  // 各サービスへ検索で飛ばす時の語。曲名だけだと同名異曲に当たるので
  // アーティスト名も混ぜる。
  const serviceSearchTerm = `${current.title} ${current.artist}`;

  // overflow-clip: transform で外側に置いた隣のディスクが overflow-hidden だと
  // スクロール可能領域を作ってしまい、フォーカス移動等の scrollIntoView で
  // レイアウト全体が横にずれる。clip はスクロール自体を不可能にする。
  return (
    <div
      className="relative mx-auto flex max-w-md select-none flex-col items-center gap-6 overflow-clip px-4 pb-2 pt-3"
      // 縦のパンをブラウザに渡さない (渡すと縦スワイプ中に pointercancel が
      // 飛んで判定が落ちる)。横パンとピンチズームはそのまま許可する。
      //
      // marginBottom: 詳細表示ではボトムナビを引っ込めるので、(app) レイアウトが
      // main に空けているナビ用の下余白 (5rem + safe-area) はその間だけ不要。
      // 打ち消して似た音域のカルーセル 1 行分を捻出する。ナビを隠す条件と
      // ここは同じ detail なので、ずれることはない。
      style={{
        touchAction: "pan-x pinch-zoom",
        marginBottom: detail
          ? "calc(-5rem - env(safe-area-inset-bottom))"
          : undefined,
      }}
      onPointerDown={handleSwipeStart}
      onPointerMove={handleSwipeMove}
      onPointerUp={handleSwipeEnd}
      onPointerCancel={handleSwipeEnd}
      onWheel={(event) => {
        if (Math.abs(event.deltaY) < 8) return;
        toggleDetail(event.deltaY < 0);
      }}
    >
      {/* 次の組の先頭ジャケットを裏で先読みする。「次の組へ」を押すまで
          見えないものなので fetchPriority は low 固定。指定を外すと、
          今まさに見えている盤 (high) より先にこの 2 枚が走ってしまう。 */}
      {(nextGroup ?? []).slice(0, 2).map((song) => {
        const preloadSrc = song.image_url_large ?? song.image_url_medium;
        return preloadSrc ? (
          <link
            key={`preload-${song.id}`}
            rel="preload"
            as="image"
            href={preloadSrc}
            fetchPriority="low"
          />
        ) : null;
      })}

      {/* バナーは overlay 配置 (flex フローに入れると縦予算 31.5rem が崩れ、
          下段ボタンが固定ナビの裏に隠れるため) */}
      {error ? (
        <div className="absolute inset-x-4 top-2 z-20 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {/* シャッフル / 消音: 画面上部の左右端に固定する。組カルーセルが
          詳細表示で畳まれても動かないよう、行ではなくデッキ全体を基準に
          置いている。背景色は敷かない (敷くとガラスが背後を拾えず「黒い丸」
          になる。明るいジャケット対策は GlassSurface の DIM 側で行う)。 */}
      <button
        type="button"
        onClick={handleShuffle}
        disabled={shuffling}
        aria-label="デッキをシャッフルする"
        inert={detail}
        className="absolute left-4 top-4 z-20 flex size-10 items-center justify-center rounded-full text-white transition active:brightness-90 disabled:opacity-60"
        // 詳細表示では消すが、disabled:opacity-60 と競合しないよう
        // クラスではなくインラインで上書きする。
        style={detail ? { opacity: 0 } : undefined}
      >
        <GlassSurface variant="overlay" />
        <Dices
          className={`relative size-5 ${shuffling ? "animate-spin" : ""}`}
          aria-hidden
        />
      </button>
      <button
        type="button"
        onClick={handleToggleAudio}
        aria-label={
          audioOn && !audioBlocked ? "試聴を停止する" : "試聴を再生する"
        }
        className="absolute right-4 top-4 z-20 flex size-10 items-center justify-center rounded-full text-white transition active:brightness-90"
      >
        <GlassSurface variant="overlay" />
        {audioOn && !audioBlocked ? (
          <Volume2 className="relative size-5" aria-hidden />
        ) : (
          <VolumeX className="relative size-5" aria-hidden />
        )}
      </button>

      {/* 組カルーセルの行。組サムネイルと、アクティブなジャケットに被せる
          アーティスト名の座布団を重ねる。詳細表示ではサムネイルが消え、
          座布団 1 行分の高さまで畳む
          (marginBottom で親の gap-6 も 0.75rem まで詰める)。 */}
      <motion.div
        className="relative w-full"
        initial={false}
        animate={{
          height: detail ? "1.5rem" : "3.5rem",
          marginBottom: detail ? "-0.75rem" : "0rem",
        }}
        transition={DETAIL_TRANSITION}
      >
        <motion.div
          role="group"
          aria-roledescription="カルーセル"
          aria-label="デッキ内の組"
          className="absolute inset-x-0 top-0 h-14"
          inert={detail}
          initial={false}
          animate={{ opacity: detail ? 0 : 1 }}
          transition={DETAIL_TRANSITION}
          // 子の rotateY に奥行きを与える (カバーフロー風の遠近)。
          // perspective は直接の子にしか効かないので、サムネイルを直に持つ
          // この層に置くこと (外側の高さアニメーション層に移すと平面になる)。
          style={{ perspective: "700px" }}
        >
          {groups.map((groupSongs, index) => {
            const seed = groupSongs[0];
            if (!seed) return null;
            const delta = index - position.group;
            const isActive = delta === 0;
            return (
              <motion.div
                key={seed.id}
                aria-hidden={!isActive}
                initial={false}
                animate={{
                  x: `${groupThumbOffset(delta)}%`,
                  rotateY: groupThumbTilt(delta),
                  scale: isActive ? 1 : 0.8,
                }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="absolute left-1/2 top-0 -ml-7 size-14"
                // 密に詰めた外側は中央寄りのサムネイルが上に重なるようにする。
                // preserve-3d で子の側面 (厚み) を 3D 空間に保つ。
                // 注意: このコンテナに opacity < 1 や filter を付けると CSS 仕様で
                // preserve-3d が平面化され、背面がジャケットに被さって描画が壊れる。
                // 減光は前面内のオーバーレイ、端の非表示は visibility で行う。
                // 非表示は delta 固定数ではなく累積オフセットで判定する
                // (間隔定数を詰めた時に画面内の項目まで隠れてポップインした反省)。
                // 430% = 240px は max-w-md の clip 半幅 224px + 投影マージンで、
                // 可視域内では絶対に切り替わらない。
                style={{
                  zIndex: 10 - Math.abs(delta),
                  transformStyle: "preserve-3d",
                  visibility:
                    Math.abs(groupThumbOffset(delta)) > 430
                      ? "hidden"
                      : "visible",
                }}
              >
                <GroupThumb seed={seed} isActive={isActive} />
              </motion.div>
            );
          })}
        </motion.div>

        {/* アーティスト名の座布団: 再生中の組のジャケットに下から少し被せ、
            右上がりに傾けて貼る。詳細表示ではサムネイルが消えるので、
            傾きを戻しながら行の頭 (= 座布団だけの行) へ収める。
            左右は size-10 のボタン (端から 2.75rem) を避けて inset-x-14。 */}
        <motion.div
          className="absolute inset-x-14 z-20 flex justify-center"
          initial={false}
          animate={{
            top: detail ? 0 : PILLOW_OVERLAP_TOP,
            rotate: detail ? 0 : PILLOW_TILT_DEG,
          }}
          transition={DETAIL_TRANSITION}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={position.group}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="flex max-w-full justify-center"
            >
              {/* アーティストページはログイン必須なので、ゲストの時は
                  リンクにせず枕だけ出す (開けない導線を作らない) */}
              {current.artist_id && !isGuest ? (
                <Link
                  href={`/artists/${current.artist_id}`}
                  className="line-clamp-1 max-w-full px-2.5 py-0.5 text-sm font-bold tracking-tight transition active:brightness-90"
                  style={{
                    backgroundColor: pillow,
                    backgroundImage: PILLOW_NOISE,
                    backgroundBlendMode: "overlay",
                    color: PILLOW_TEXT,
                    fontFamily: PILLOW_FONT,
                  }}
                >
                  {current.artist}
                </Link>
              ) : (
                <span
                  className="line-clamp-1 max-w-full px-2.5 py-0.5 text-sm font-bold tracking-tight"
                  style={{
                    backgroundColor: pillow,
                    backgroundImage: PILLOW_NOISE,
                    backgroundBlendMode: "overlay",
                    color: PILLOW_TEXT,
                    fontFamily: PILLOW_FONT,
                  }}
                >
                  {current.artist}
                </span>
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* 組単位で左へ流れる。中は曲単位のカルーセル + 曲情報 */}
      <div className="relative w-full">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={position.group}
            initial={{ x: 72, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -72, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex w-full flex-col items-center gap-6"
          >
            {/* 曲順 + 楽曲名 + リリース年。アーティスト名の座布団の真下に置く。
              曲名は座布団と同じ face、曲順とリリース年は楽曲情報と同じ等幅
              face で軽めに添える。-my-2 で上下の gap-6 を 1rem まで詰め、
              座布団 (行から 0.5rem はみ出す) と近づけている。 */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={current.id}
                initial={{ y: 10, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -10, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="-my-2 w-full px-2"
              >
                {/* 曲順とリリース年は文字数が違うので、素直に並べると曲名が
                  その差だけ横にずれる。左右を 1fr の等幅トラックにして
                  中央トラック (曲名) を必ず画面中央へ置く。年が無い曲でも
                  トラックは残すので、ずれない。min-w は両側の最小幅を
                  揃えるためで、これが無いと窮屈な時だけ非対称に潰れる。 */}
                <h2 className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-2 text-2xl font-bold">
                  {/* text-right: min-w で確保した余白は曲名との間ではなく
                    表示順の左側に置く (既定の左寄せだと #1 と曲名の間だけが
                    リリース年側の 4 倍空いて、曲名が右にずれて見える) */}
                  <span className="min-w-11 justify-self-end text-right font-mono text-sm font-light text-zinc-500 dark:text-zinc-400">
                    #{position.song + 1}
                  </span>
                  {/* min-w-0: line-clamp の親が grid なので、これが無いと
                    曲名の最小内容幅がデッキごと画面外へ押し広げる */}
                  <Link
                    href={`/songs/${current.id}`}
                    className="line-clamp-1 min-w-0 hover:underline"
                    style={{ fontFamily: PILLOW_FONT }}
                  >
                    {current.title}
                  </Link>
                  <span className="min-w-11 justify-self-start font-mono text-sm font-light text-zinc-500 dark:text-zinc-400">
                    {current.release_year
                      ? `('${String(current.release_year).slice(-2)})`
                      : ""}
                  </span>
                </h2>
              </motion.div>
            </AnimatePresence>

            {/* ジャケットのカルーセル (遷移ボタンなし。回転完了 or スキップで進む) */}
            <motion.div
              role="group"
              aria-roledescription="カルーセル"
              aria-label="同じアーティストの楽曲"
              className="relative mx-auto"
              style={{
                width: detail ? DISC_SIZE_DETAIL : DISC_SIZE,
                height: detail ? DISC_SIZE_DETAIL : DISC_SIZE,
                transition: "width 0.24s ease-out, height 0.24s ease-out",
              }}
            >
              {group.map((song, index) => {
                const delta = index - position.song;
                const isActive = delta === 0;
                return (
                  <motion.div
                    key={song.id}
                    aria-hidden={!isActive}
                    initial={false}
                    animate={{
                      x: `${delta * SLIDE_OFFSET_PERCENT}%`,
                      scale: isActive ? 1 : 0.65,
                      // 詳細表示は再生中の 1 枚だけの画面なので、前後の盤は
                      // 端から覗かせない (display を切ると復帰時にポップイン
                      // するので、フェードで消して位置は保っておく)
                      opacity: isActive
                        ? 1
                        : detail || Math.abs(delta) > 1
                          ? 0
                          : 0.45,
                    }}
                    transition={{ type: "spring", stiffness: 260, damping: 30 }}
                    className="absolute inset-0"
                    // 現在の盤を最前面に。隣の盤は縮小したまま端から覗き、
                    // スライド時は現在の盤の後ろへ滑り込む
                    style={{
                      zIndex: isActive ? 10 : Math.abs(delta) === 1 ? 5 : 0,
                    }}
                  >
                    <RecordDisc
                      song={song}
                      // 楽曲ページ表示中は回転を止める。詳細表示では 30 秒を
                      // 流し切った時点で止める。曲送りはもう回転とは無関係
                      // なので、これは純粋に見た目の停止。
                      active={isActive && !sheetOpen && !detailEnded}
                    />
                  </motion.div>
                );
              })}
            </motion.div>

            {/* 詳細表示でだけレコードの下に出る、シートと同じ楽曲情報。
              外側の AnimatePresence は組が変わるたびに作り直されるので、
              initial={false} で「組送りでは開閉アニメを再生しない」。
              曲送りでは中身のテキストだけが差し替わる。 */}
            <AnimatePresence initial={false}>
              {detail ? (
                <motion.div
                  key="detail"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={DETAIL_TRANSITION}
                  className="w-full overflow-hidden text-center"
                >
                  <dl className="mx-auto max-w-60 bg-zinc-100 px-4 text-left text-sm dark:bg-zinc-800/60">
                    <div className="flex items-baseline py-2">
                      <dt className="spec-label w-12 shrink-0 text-zinc-600 dark:text-zinc-400">
                        <span>地声</span>
                      </dt>
                      <dd className="font-mono">
                        {current.range_low_midi == null &&
                        current.range_high_midi == null ? (
                          "—"
                        ) : (
                          <>
                            <ColoredNote midi={current.range_low_midi} />
                            {" — "}
                            <ColoredNote midi={current.range_high_midi} />
                          </>
                        )}
                      </dd>
                    </div>
                    <div className="spec-rule flex items-baseline py-2">
                      <dt className="spec-label w-12 shrink-0 text-zinc-600 dark:text-zinc-400">
                        <span>裏声</span>
                      </dt>
                      <dd className="font-mono">
                        <ColoredNote midi={current.falsetto_max_midi} />
                      </dd>
                    </div>
                    <div className="spec-rule flex items-baseline py-2">
                      <dt className="spec-label w-12 shrink-0 text-zinc-600 dark:text-zinc-400">
                        <span>長さ</span>
                      </dt>
                      <dd className="font-mono font-medium">
                        {formatDuration(current.duration_ms) || "—"}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                    {/* sort=4 = 歌詞ネットの人気順。検索結果をいきなり
                          人気順で開いて、目当ての曲を探す手間を省く */}
                    <Link
                      href={`https://www.uta-net.com/search/?target=song&type=in&Keyword=${encodeURIComponent(current.title)}&sort=4`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="歌詞ネットで歌詞を見る"
                      className={DETAIL_ACTION_CLASS}
                    >
                      <ScrollText className="size-4" aria-hidden />
                      <span>歌詞を見る</span>
                    </Link>
                    {/* songs に Apple 側の id は持っていないので、曲名 +
                          アーティストの検索で開く (Music アプリの universal
                          link なので、iOS なら Music が直接立ち上がる) */}
                    <Link
                      href={`https://music.apple.com/jp/search?term=${encodeURIComponent(serviceSearchTerm)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="iTunes で聴く"
                      className={DETAIL_ACTION_CLASS}
                    >
                      <Music className="size-4" aria-hidden />
                      <span>iTunesで聴く</span>
                    </Link>
                    {/* track id があれば曲へ直接、無ければ検索へ逃がす */}
                    <Link
                      href={
                        current.spotify_track_id
                          ? `https://open.spotify.com/track/${current.spotify_track_id}`
                          : `https://open.spotify.com/search/${encodeURIComponent(serviceSearchTerm)}`
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Spotify で聴く"
                      className={DETAIL_ACTION_CLASS}
                    >
                      <Play className="size-3.5 fill-current" aria-hidden />
                      <span>Spotifyで聴く</span>
                    </Link>
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 4 評価ボタン (丸いアイコンボタン + ラベル) */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={(event) => handleRate(r.value, event.currentTarget)}
            className="flex flex-col items-center gap-1.5 transition active:scale-95"
            aria-label={r.label}
          >
            <RatingKnob rating={r} filled={flashRating === r.value} />
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {r.label}
            </span>
          </button>
        ))}
      </div>

      {/* 似た音域の楽曲 (詳細表示のみ)。評価ボタンの下、スキップ行の代わりに
          出る位置。ここは組ではなく曲に紐づくので、組の AnimatePresence の
          外に置いて曲送りでも滑らかに差し替わるようにしている。 */}
      <AnimatePresence initial={false}>
        {detail ? (
          <motion.div
            key="similar"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={DETAIL_TRANSITION}
            // -mt-3: カードを音域が収まる幅 (4.5rem) に広げるとジャケットも
            // 正方形のぶん高くなるので、その 12px を評価ボタンとの間隔から
            // 返してもらい、詳細全体の高さは変えない。
            className="-mt-3 w-full overflow-hidden"
          >
            <SimilarSongsCarousel
              songs={similarSongs}
              loading={similarSongs === undefined}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* スキップ 2 種 (同サイズ) + 戻る。詳細表示では高さごと畳む
          (marginTop で直前の gap-6 も相殺する) */}
      <motion.div
        inert={detail}
        initial={false}
        animate={{
          height: detail ? "0rem" : "3.5rem",
          marginTop: detail ? "-1.5rem" : "0rem",
          opacity: detail ? 0 : 1,
        }}
        transition={DETAIL_TRANSITION}
        className="w-full overflow-hidden"
      >
        <div className="grid w-full grid-cols-[1fr_1fr_3.5rem] items-center gap-3">
          {/* 枠線と塗りは currentColor なので、ボタンの文字色がそのまま
              乗る。塗られている間だけ中身を地の色へ反転させる。 */}
          <button
            ref={skipRef}
            type="button"
            onClick={handleSkipSong}
            className="relative flex h-14 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-zinc-800 transition active:scale-95 dark:text-zinc-300"
          >
            <MarkerSurface
              fill={skipSongFill}
              filled={flashAction === "skip-song"}
              id="skip-song"
            />
            <span
              className={`relative flex items-center gap-1.5 transition-colors duration-200 ${
                flashAction === "skip-song" ? "text-zinc-50" : ""
              }`}
            >
              <SkipForward className="size-4" aria-hidden />
              1曲スキップ
            </span>
          </button>
          <button
            type="button"
            onClick={handleSkipGroup}
            className="relative flex h-14 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-zinc-800 transition active:scale-95 dark:text-zinc-300"
          >
            <MarkerSurface
              fill={skipGroupFill}
              filled={flashAction === "skip-group"}
              id="skip-group"
            />
            <span
              className={`relative flex items-center gap-1.5 transition-colors duration-200 ${
                flashAction === "skip-group" ? "text-zinc-50" : ""
              }`}
            >
              <FastForward className="size-4" aria-hidden />
              次の組へ
            </span>
          </button>
          <button
            type="button"
            onClick={handleBack}
            disabled={!lastAction && !previousPosition}
            className="relative mx-auto flex size-14 items-center justify-center rounded-full text-zinc-800 transition active:scale-95 disabled:opacity-30 dark:text-zinc-300"
            aria-label="前の曲に戻る"
          >
            <MarkerSurface
              fill={backFill}
              filled={flashAction === "back"}
              id="back"
            />
            <Undo2
              className={`relative size-5 transition-colors duration-200 ${
                flashAction === "back" ? "text-zinc-50" : ""
              }`}
            />
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/**
 * 音域ノートを、高さ由来の色のマーカーで引いた形で表示する。
 * null は無印 "—" (楽曲ページと同じ)。
 *
 * 帯は文字幅に合わせて組むので、描く前に一度実測する。書体が後から
 * 差し替わっても追従するよう ResizeObserver で見張る。
 */
function ColoredNote({ midi }: { midi: number | null | undefined }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w > 0 && h > 0) {
        setBox((prev) => (prev?.w === w && prev?.h === h ? prev : { w, h }));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [midi]);

  if (midi == null) return <>—</>;

  const label = midiToKaraoke(midi);
  const { background, foreground } = noteChipColor(midi);
  const mark = box ? buildHighlight(label, box.w, box.h) : null;

  return (
    <span className="relative inline-block">
      {mark ? (
        <svg
          width={mark.width}
          height={mark.height}
          viewBox={`0 0 ${mark.width} ${mark.height}`}
          className="pointer-events-none absolute"
          style={{
            left: mark.offset,
            top: mark.offset,
            opacity: HIGHLIGHT_OPACITY,
            // 乗算を紙面まで巻き込ませない (重なった帯だけを濃くする)
            isolation: "isolate",
          }}
          aria-hidden
        >
          <g
            transform={`rotate(${HIGHLIGHT_TILT_DEG} ${mark.width / 2} ${mark.height / 2})`}
          >
            {mark.paths.map((d, i) => (
              <path
                key={i}
                d={d}
                fill={background}
                style={i === 1 ? { mixBlendMode: "multiply" } : undefined}
              />
            ))}
          </g>
        </svg>
      ) : null}
      <span
        ref={textRef}
        className="relative px-0.5"
        style={{ color: mark ? foreground : background }}
      >
        {label}
      </span>
    </span>
  );
}

/** 抽出済みの代表色キャッシュ (ジャケット URL → CSS color) */
const vinylColorCache = new Map<string, string>();

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * ジャケット画像からカラーヴァイナル用の代表色を表示時に抽出する。
 * 全体平均だと複数の色が混ざった中間色に濁るため、色相ヒストグラム
 * (15° × 24 bin) で最も優勢な色域を選び、その bin 内の加重平均だけで
 * 色を決める = 画像の「支配色」。彩度が全体的に無い画像 (モノクロ) は
 * 色を発明せず明度のみのグレーにする。暗い背景で映えるよう明度は
 * レコード盤らしい範囲にクランプする。
 * CORS で読めない画像は null のまま (呼び出し側が無彩色 fallback)。
 */
function useVinylColor(src: string | null, immediate = true): string | null {
  // 抽出完了時に再レンダーを起こすためのバージョンカウンタ。
  // 色自体は render 時にキャッシュから読む (effect 内の同期 setState を避ける)
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!src || vinylColorCache.has(src)) return;
    let cancelled = false;
    // 抽出用の取得は表示用の <img> とは別の CORS リクエストになるため、
    // 見えている 1 枚以外は idle まで待たせる。マウント直後に全枚数ぶん
    // 走らせると、今まさに見えている盤の取得と帯域を奪い合う。
    let idleId: number | undefined;
    let timerId: number | undefined;
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const SIZE = 24;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
        // 色相ヒストグラム: 有彩色ピクセルを 15° 刻みの bin に投票させる。
        // 重みは彩度 × 中明度寄り (白飛び・黒潰れの寄与を抑える)。
        // 色相は角度なので bin 内はベクトル平均で合成する。
        const BINS = 24;
        const binW = new Array<number>(BINS).fill(0);
        const binX = new Array<number>(BINS).fill(0);
        const binY = new Array<number>(BINS).fill(0);
        const binS = new Array<number>(BINS).fill(0);
        const binL = new Array<number>(BINS).fill(0);
        let greyL = 0;
        let greyN = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const l = (mx + mn) / 2;
          const d = mx - mn;
          const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
          greyL += l;
          greyN++;
          // 無彩色・極端な明暗は色相の投票に加えない
          if (s < 0.18 || l < 0.08 || l > 0.95) continue;
          let h = 0;
          if (mx === r) h = ((g - b) / d) % 6;
          else if (mx === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
          const wt = s * (1 - Math.abs(l - 0.5));
          const bin = Math.floor(h / (360 / BINS)) % BINS;
          const rad = (h * Math.PI) / 180;
          binW[bin] += wt;
          binX[bin] += wt * Math.cos(rad);
          binY[bin] += wt * Math.sin(rad);
          binS[bin] += wt * s;
          binL[bin] += wt * l;
        }
        // 隣接 bin と合算して優勢な色域を選ぶ (bin 境界で票が割れるのを防ぐ)
        let best = -1;
        let bestScore = 0;
        for (let i = 0; i < BINS; i++) {
          const score =
            binW[(i + BINS - 1) % BINS] + binW[i] + binW[(i + 1) % BINS];
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        }
        // 有彩色の票が実質無い画像はモノクロ扱い (色を発明しない)
        const totalPixels = data.length / 4;
        let result: string;
        if (best < 0 || bestScore < totalPixels * 0.02) {
          const l = greyN > 0 ? greyL / greyN : 0.55;
          result = `hsl(0, 0%, ${Math.round(clamp(l, 0.45, 0.7) * 100)}%)`;
        } else {
          const idxs = [(best + BINS - 1) % BINS, best, (best + 1) % BINS];
          let w = 0;
          let x = 0;
          let y = 0;
          let s = 0;
          let l = 0;
          for (const i of idxs) {
            w += binW[i];
            x += binX[i];
            y += binY[i];
            s += binS[i];
            l += binL[i];
          }
          const h = (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
          result = `hsl(${Math.round(h)}, ${Math.round(
            clamp((s / w) * 1.1, 0.15, 0.7) * 100,
          )}%, ${Math.round(clamp(l / w, 0.5, 0.72) * 100)}%)`;
        }
        vinylColorCache.set(src, result);
        if (!cancelled) setVersion((v) => v + 1);
      } catch {
        // CORS 汚染 (getImageData 不可) 等。fallback の無彩色のままにする
      }
    };
    const start = () => {
      if (!cancelled) img.src = src;
    };
    if (immediate) {
      start();
    } else if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(start, { timeout: 2000 });
    } else {
      // requestIdleCallback を持たない環境 (Safari 16.3 以前) の代替
      timerId = window.setTimeout(start, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [src, immediate]);

  return src ? (vinylColorCache.get(src) ?? null) : null;
}

/**
 * 組カルーセルのサムネイル 1 枚分の面 (前面/背面/左右側面)。
 * 親の motion.div (preserve-3d) の直下に fragment で面を並べる。
 * 側面 = 背表紙はジャケットの代表色 (レコード盤と同じ抽出) を黒へ大きく
 * 落とした暗色で塗り、アーティスト名を背表紙テキストとして載せる。
 * 左右の面は、傾いた時に外から見える側が表 (正立テキスト) になるよう
 * rotateY の向きを分けている (左面 -90° / 右面 +90°)。
 */
/**
 * 背表紙用に代表色を暗くする。useVinylColor が生成する hsl() 文字列を
 * 自前でパースして明度だけ落とす (color-mix はまだ全対象ブラウザで
 * 保証できないため使わない。透明フォールバックで背表紙が消えるのを防ぐ)。
 */
function spineColorOf(edgeColor: string): string {
  const m = /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(edgeColor);
  if (!m) return "#1c1c21";
  return `hsl(${m[1]}, ${m[2]}%, ${Math.round(Number(m[3]) * 0.38)}%)`;
}

/** 座布団の文字色。note.ts の chip() の前景と同じ暗い zinc */
const PILLOW_TEXT = "oklch(0.25 0.02 260)";

/**
 * 座布団に要求する最低輝度。PILLOW_TEXT (輝度 ≈ 0.043) との
 * コントラスト比が約 5:1 になる線。
 */
const PILLOW_MIN_LUMINANCE = 0.42;

/** 明度を持ち上げる上限 (%)。ここまで上げても届かない色は諦める */
const PILLOW_MAX_LIT = 92;

/**
 * hsl() 成分から sRGB の相対輝度 (WCAG) を出す。座布団の読みやすさを
 * HSL の L だけで測ると、同じ L 50% でも黄色は明るく青は暗いのに同じ扱いに
 * なってしまう (実際、青い盤の補色の琥珀は読めるのに、橙の盤の補色の青は
 * 暗文字でも白文字でもコントラストが 4:1 に届かなかった)。
 */
function hslLuminance(h: number, s: number, l: number): number {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  const rgb = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6].map((v) => v + m);
  const lin = (v: number) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/**
 * アーティスト名の座布団の色。1 枚目のレコードの代表色の反対色 =
 * 色相を 180° 回した色を敷く。
 * 明度は色相を回しただけでは足りない: HSL の L が同じでも黄は明るく青は
 * 暗いので、橙の盤の補色 (青) は暗文字でも白文字でもコントラストが 4:1 に
 * 届かなかった。そこで色相は反対のまま、暗い文字が確実に読める輝度まで
 * 明度だけを持ち上げる。もともと明るい補色 (琥珀など) は手つかずで済む。
 * 色相を持たない盤 (モノクロのジャケット) は回しても同じ色にしかならない
 * ので明度で反転させる。ただし素直に 100 - L とすると、盤の明度帯
 * (45〜70%) の反対は 30〜55% = 元とほとんど差が無く、しかも暗い背景に
 * 沈んで「座布団」として機能しない。そこで明暗の向きだけ反転させたまま、
 * 紙らしい明るい帯 (82〜92%) へ写す。
 * 代表色がまだ無い / CORS で読めない間は無彩色の明るいグレーで待つ。
 */
function pillowColorOf(vinylColor: string | null): string {
  const m = vinylColor
    ? /^hsl\((\d+), (\d+)%, (\d+)%\)$/.exec(vinylColor)
    : null;
  if (!m) return "hsl(0, 0%, 78%)";

  const [, h, s, l] = m;
  const sat = Number(s);
  const hue = sat === 0 ? 0 : (Number(h) + 180) % 360;

  let lit =
    sat === 0
      ? Math.round(92 - (clamp(Number(l), 45, 70) - 45) * 0.4)
      : Number(l);
  while (
    lit < PILLOW_MAX_LIT &&
    hslLuminance(hue, sat, lit) < PILLOW_MIN_LUMINANCE
  ) {
    lit += 2;
  }

  return `hsl(${hue}, ${sat}%, ${lit}%)`;
}

function GroupThumb({ seed, isActive }: { seed: Song; isActive: boolean }) {
  const thumbSrc = seed.image_url_medium ?? seed.image_url_large;
  // 厚みが陰として読めるよう、代表色を大きく暗くして背表紙に塗る
  // 背表紙の色は現在の組だけ先に出す (残り 6 組ぶんは idle まで待たせる)。
  const spineColor = spineColorOf(
    useVinylColor(thumbSrc, isActive) ?? "#3f3f46",
  );
  const spineStyle = {
    backgroundColor: spineColor,
    borderRadius: GROUP_THUMB_RADIUS_PX,
    transition: "background-color 0.5s ease",
    width: GROUP_THUMB_DEPTH_PX,
  } as const;
  // 背表紙のアーティスト名: 上から下へ読む縦倒しテキスト (洋書の背文字)。
  // 面 (厚み × 高さ) の中央に、高さぶんの横書きコンテナを -90° 回転で敷く。
  // 実効 6px 相当は 12px を scale(0.5) で出す (ブラウザの最小フォント
  // サイズ設定に 6px 指定がクランプされて面からはみ出すのを防ぐ)。
  const spineText = (
    <span
      className="absolute left-1/2 top-1/2 block overflow-hidden text-ellipsis whitespace-nowrap px-3 text-left font-semibold text-white/70"
      style={{
        width: "7rem",
        height: GROUP_THUMB_DEPTH_PX * 2,
        transform: "translate(-50%, -50%) rotate(90deg) scale(0.5)",
        fontSize: 12,
        lineHeight: `${GROUP_THUMB_DEPTH_PX * 2}px`,
      }}
    >
      {seed.artist}
    </span>
  );
  return (
    <>
      {/* 前面: ジャケット。厚みの半分だけ手前へ */}
      <div
        className="absolute inset-0 overflow-hidden bg-zinc-800"
        style={{
          borderRadius: GROUP_THUMB_RADIUS_PX,
          transform: `translateZ(${GROUP_THUMB_DEPTH_PX / 2}px)`,
        }}
      >
        {thumbSrc ? (
          <JacketImage
            src={thumbSrc}
            alt={isActive ? `${seed.artist} の組` : ""}
            fill
            sizes="3.5rem"
            className="object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-lg text-zinc-500">
            ♪
          </div>
        )}
        {/* 非アクティブの減光 (コンテナの opacity の代替) */}
        <div
          aria-hidden
          className="absolute inset-0 bg-black transition-opacity duration-300"
          style={{ opacity: isActive ? 0 : 0.55 }}
        />
      </div>
      {/* 背面 (スプリングのオーバーシュート対策の保険) */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundColor: spineColor,
          borderRadius: GROUP_THUMB_RADIUS_PX,
          transition: "background-color 0.5s ease",
          transform: `rotateY(180deg) translateZ(${GROUP_THUMB_DEPTH_PX / 2}px)`,
        }}
      />
      {/* 左右の側面 = 厚み。傾くほど見えてくる背表紙 */}
      <div
        aria-hidden
        className="absolute top-0 h-full"
        style={{
          ...spineStyle,
          left: -GROUP_THUMB_DEPTH_PX / 2,
          transform: "rotateY(-90deg)",
        }}
      >
        {spineText}
      </div>
      <div
        aria-hidden
        className="absolute top-0 h-full"
        style={{
          ...spineStyle,
          right: -GROUP_THUMB_DEPTH_PX / 2,
          transform: "rotateY(90deg)",
        }}
      >
        {spineText}
      </div>
    </>
  );
}

interface RecordDiscProps {
  song: Song;
  /** 現在再生位置のディスクのみ回転する (曲送りとは無関係な装飾) */
  active: boolean;
}

/**
 * ジャケット写真を表示時に CSS でレコード盤へ加工する。
 * 中央のラベル (直径 52%) にだけジャケットを置き、外周はジャケットから
 * 抽出した代表色のカラーヴァイナルとして表現する。溝 / ラベル境界 /
 * 光沢 / センターホールをレイヤーで重ねる。回転体は正円なので
 * シルエットが不変であり、overflow-hidden との組み合わせでも輪郭が
 * 乱れない。光沢は光源固定に見せるため回転体の外に置く。
 */
function RecordDisc({ song, active }: RecordDiscProps) {
  const src = song.image_url_large ?? song.image_url_medium;
  // 隣の盤の代表色は今すぐ要らない (縮小 + 半透明で端に覗くだけ)。
  const vinylColor = useVinylColor(src, active);
  return (
    <div className="relative h-full w-full">
      {/* 回転体: 代表色の盤面 + 溝 + 中央ラベル (ジャケット)。
          隣の盤 (opacity 0.45 + transform で合成レイヤー化) では iOS WebKit が
          「祖先による子のクリップ」を落とすことがある。rounded-full +
          overflow-hidden だけでなく、この clip-path も iOS 18 では落ちる。
          そのため祖先のクリップはあくまで第一線とし、四角く塗る子レイヤー
          (盤面色 / ラベル / img) はそれぞれ自分自身の rounded-full で正円を
          自衛する。clip-path は回転 transform に不変なのでここに残す。 */}
      <div
        className="absolute inset-0"
        style={{
          clipPath: "circle(50% at 50% 50%)",
          WebkitClipPath: "circle(50% at 50% 50%)",
          animation: `record-spin ${ROTATION_MS}ms linear infinite`,
          // 止める時はアニメーションを外さず一時停止する。外すと角度が
          // 0 度へ飛ぶので、再開のたびに盤が跳ねて見える。
          animationPlayState: active ? "running" : "paused",
        }}
      >
        {/* 盤面: ジャケットの代表色 (抽出完了までは無彩色)。
            rounded-full は自衛: iOS 18 の WebKit は合成レイヤー化した隣の盤で
            親の clip-path による子クリップも落とすため、四角く塗る層は
            自分自身の角丸で正円を保証する (溝レイヤーが自前 mask なのと同じ理屈) */}
        <div
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            backgroundColor: vinylColor ?? "#3f3f46",
            transition: "background-color 0.5s ease",
          }}
        />
        {/* 溝: 1px 間隔の同心円リング。ラベル部 (中心 52%) と最外周は mask で除く */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "repeating-radial-gradient(circle at center, rgba(0,0,0,0.30) 0px, rgba(0,0,0,0.30) 0.8px, rgba(255,255,255,0.07) 1.6px, rgba(0,0,0,0.10) 2.6px, rgba(0,0,0,0.10) 4px)",
            maskImage:
              "radial-gradient(circle closest-side at center, transparent 0%, transparent 51%, black 55%, black 96%, transparent 99%)",
            WebkitMaskImage:
              "radial-gradient(circle closest-side at center, transparent 0%, transparent 51%, black 55%, black 96%, transparent 99%)",
          }}
        />
        {/* 中央ラベル: ジャケット写真。コンテナの clip-path に加え、
            自身と img にも rounded-full (上の盤面と同じ自衛。親クリップが
            落ちても画像が四角く漏れない) */}
        <div
          className="absolute rounded-full bg-zinc-800"
          style={{
            inset: "24%",
            clipPath: "circle(50% at 50% 50%)",
            WebkitClipPath: "circle(50% at 50% 50%)",
          }}
        >
          {src ? (
            <JacketImage
              src={src}
              alt={`${song.title} のジャケット`}
              fill
              sizes="10.5rem"
              // 組の全曲ぶんの盤が同時に居るので、今見えている 1 枚だけを
              // 先に取りに行く。隣の盤を同格で eager にすると、一番大事な
              // 1 枚が数百 KB の非表示の盤と帯域を分け合うことになる。
              loading={active ? "eager" : "lazy"}
              fetchPriority={active ? "high" : "low"}
              className="rounded-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl text-zinc-500">
              ♪
            </div>
          )}
        </div>
        {/* ラベルの外周リング */}
        <div
          aria-hidden
          className="absolute rounded-full border border-white/25"
          style={{ inset: "24%" }}
        />
      </div>

      {/* 光沢 (静止レイヤー: 光源は固定のまま盤だけ回る) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "conic-gradient(from 205deg at 50% 50%, rgba(255,255,255,0.30) 0deg, rgba(255,255,255,0) 42deg, rgba(255,255,255,0) 138deg, rgba(255,255,255,0.22) 180deg, rgba(255,255,255,0) 222deg, rgba(255,255,255,0) 318deg, rgba(255,255,255,0.30) 360deg)",
          mixBlendMode: "screen",
          opacity: 0.55,
        }}
      />
      {/* 外周のエッジ光 + 内側への落ち影 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          boxShadow:
            "inset 0 0 1.5px 1px rgba(255,255,255,0.3), inset 0 0 20px 8px rgba(0,0,0,0.5)",
        }}
      />
      {/* センターホール */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 size-[4.5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-950"
        style={{
          boxShadow:
            "0 0 0 2px rgba(255,255,255,0.35), inset 0 1px 3px rgba(0,0,0,0.9)",
        }}
      />
    </div>
  );
}

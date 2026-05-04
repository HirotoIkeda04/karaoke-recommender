"use client";

import {
  AnimatePresence,
  animate,
  motion,
  type PanInfo,
  useMotionValue,
  useTransform,
} from "framer-motion";
import {
  Check,
  Dumbbell,
  Headphones,
  Minus,
  Play,
  Undo2,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { triggerHaptic } from "@/lib/haptics";
import { midiToKaraoke } from "@/lib/note";
import type { Database } from "@/types/database";

import { markSkipped, rateSong, unrateSong } from "./actions";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type Rating = Database["public"]["Enums"]["rating_type"];

/**
 * 直前のアクション。「戻る」で取り消すために保持する。
 * rating: 'easy'/'medium'/'practicing'/'hard' は通常評価、'skip' はスキップ。
 * いずれも DB 行が存在するので、戻る時は unrateSong (= DELETE) で消す。
 */
type LastAction = { song: Song; rating: Rating };

interface SwipeDeckProps {
  initialSongs: Song[];
  /** Spotify で聴いたことがある曲の id 一覧 (バッジ表示用、未連携なら空配列) */
  knownSongIds?: string[];
}

const SWIPE_THRESHOLD = 110;

// halo / ラベルが peak になる距離 (~150px)。一旦そこまでゆっくり移動し
// 色を見せる中継点として使う。
const SWIPE_HOLD_DISTANCE = 180;
const SWIPE_OUT_DISTANCE = 700;

// AnimatePresence の custom 経由で受け取った rating に応じ、退場方向を変える。
// 既存の boxShadow / SwipeOverlay は x,y の motion value に追従しているため、
// 飛んでいく途中で自動的に方向に応じた色のハロー＋ラベルが表示される。
//
// 2 段階アニメーション:
//   1) 0 → SWIPE_HOLD_DISTANCE (~55%): ゆっくり移動して色 halo + ラベルを見せる
//   2) → SWIPE_OUT_DISTANCE (残り 45%): 画面外へ排出 + フェードアウト
// undo 時の sentinel。元 current は AnimatePresence から押し出されて exit が
// 必ず通るが、同時に upcoming 側でも描画されるため、瞬時に消して被りだけで済ませる。
type ExitMode = Rating | "instant" | null;

const SWIPE_EXIT_VARIANTS = {
  exit: (rating: ExitMode | undefined) => {
    if (rating === "instant") {
      return { opacity: 0, transition: { duration: 0 } };
    }
    const transition = {
      duration: 0.38,
      times: [0, 0.5, 1],
      ease: "easeIn" as const,
      // zIndex は補間させず一瞬で適用 (退場中カードを新しい current の上に維持)
      zIndex: { duration: 0 },
    };
    const opacity = [1, 1, 0];
    const zIndex = 10;
    switch (rating) {
      case "hard":
        return {
          x: [0, -SWIPE_HOLD_DISTANCE, -SWIPE_OUT_DISTANCE],
          opacity,
          zIndex,
          transition,
        };
      case "easy":
        return {
          x: [0, SWIPE_HOLD_DISTANCE, SWIPE_OUT_DISTANCE],
          opacity,
          zIndex,
          transition,
        };
      case "medium":
        // 上辺は上向き固定 (rotate 0) のまま、わずかに右へオフセット。
        return {
          x: [0, SWIPE_HOLD_DISTANCE * 0.02, SWIPE_OUT_DISTANCE * 0.025],
          y: [0, -SWIPE_HOLD_DISTANCE, -SWIPE_OUT_DISTANCE],
          rotate: 0,
          opacity,
          zIndex,
          transition,
        };
      case "practicing":
        // 同上。上辺は上向きのまま、わずかに左へオフセット。
        return {
          x: [0, -SWIPE_HOLD_DISTANCE * 0.02, -SWIPE_OUT_DISTANCE * 0.025],
          y: [0, SWIPE_HOLD_DISTANCE, SWIPE_OUT_DISTANCE],
          rotate: 0,
          opacity,
          zIndex,
          transition,
        };
      default:
        return {
          scale: 0.9,
          opacity: 0,
          zIndex,
          transition: { duration: 0.15, zIndex: { duration: 0 } },
        };
    }
  },
};

// Web Audio で「練習中」音 (Cmaj7 ハープ + 低域ドン + 高域シマー) を
// ベースに、4 つの評価ボタンで和音 voicing と細部だけ変えて A/B 比較
// できるようにする。AudioContext はタップ初回に遅延生成して使い回す。
let audioCtx: AudioContext | null = null;
function playLowThump(
  ctx: AudioContext,
  now: number,
  freqStart: number,
  freqEnd: number,
  dur: number,
  peak: number,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(peak, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + dur + 0.02);
}
function playPartial(
  ctx: AudioContext,
  start: number,
  freq: number,
  dur: number,
  peak: number,
  endRatio = 0.85,
) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(freq * endRatio, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}
function triggerClickSound(rating: Rating) {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return;
  try {
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const ctx = audioCtx;
    const now = ctx.currentTime;

    // 共通: 低域ドン + 上にハープアルペジオのみ (高域シマー / ガラス音は廃止)。
    playLowThump(ctx, now, 260, 130, 0.18, 0.28);
    const harp = (notes: ReadonlyArray<number>, stagger: number, peak = 0.085) => {
      notes.forEach((f, i) => {
        playPartial(ctx, now + i * stagger, f, 0.32 + i * 0.03, peak, 1);
      });
    };

    if (rating === "hard") {
      // 1 オクターブ下げた Cmaj7 (C5/E5/G5/B5)。温かい響き。
      harp([523.25, 659.25, 783.99, 987.77], 0.045);
    } else if (rating === "medium") {
      // Cmaj7 (C6 系) スタッガー詰め (0.025s) で素早く決まる。
      harp([1046.5, 1318.5, 1568.0, 1975.53], 0.025);
    } else if (rating === "easy") {
      // Cmaj9 (D7 追加)。9 度を載せて一段華やか。
      harp([1046.5, 1318.5, 1568.0, 1975.53, 2349.32], 0.045, 0.08);
    } else {
      // practicing (基準): Cmaj7 (C6/E6/G6/B6) スタッガー長め。
      harp([1046.5, 1318.5, 1568.0, 1975.53], 0.045);
    }
  } catch {
    // 音が出せなくても評価操作自体は止めない。
  }
}

const RATINGS: ReadonlyArray<{
  value: Rating;
  label: string;
  Icon: typeof X;
  color: string;
}> = [
  {
    value: "hard",
    label: "苦手",
    Icon: X,
    color:
      "bg-[linear-gradient(135deg,#f87171_0%,#ef4444_28%,#ef4444_72%,#b91c1c_100%)] hover:brightness-110 active:brightness-95",
  },
  {
    value: "medium",
    label: "普通",
    Icon: Minus,
    color:
      "bg-[linear-gradient(135deg,#fcd34d_0%,#eab308_28%,#eab308_72%,#a16207_100%)] hover:brightness-110 active:brightness-95",
  },
  {
    value: "easy",
    label: "得意",
    Icon: Check,
    color:
      "bg-[linear-gradient(135deg,#34d399_0%,#10b981_28%,#10b981_72%,#047857_100%)] hover:brightness-110 active:brightness-95",
  },
  {
    value: "practicing",
    label: "練習中",
    Icon: Dumbbell,
    color:
      "bg-[linear-gradient(135deg,#c084fc_0%,#a855f7_28%,#a855f7_72%,#7e22ce_100%)] hover:brightness-110 active:brightness-95",
  },
];

export function SwipeDeck({
  initialSongs,
  knownSongIds = [],
}: SwipeDeckProps) {
  const [queue, setQueue] = useState(initialSongs);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 直前に発火させた exit の方向。AnimatePresence の custom 経由で
  // 退場中のカードに伝え、評価ごとに異なる方向へ飛んでいかせる。
  // undo 時は "instant" を立てて、元 current の exit を 0 秒で済ませる。
  const [exitRating, setExitRating] = useState<ExitMode>(null);
  // undo で復活したカードを、出ていった方向から逆再生でスライドインさせる。
  const [enterFrom, setEnterFrom] = useState<Rating | null>(null);
  const knownSet = useMemo(() => new Set(knownSongIds), [knownSongIds]);

  // 評価タブにいる間は body スクロールをロック (カード操作中の誤スクロール防止)。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const current = queue[0];
  const upcoming = queue.slice(1, 3);

  const handleRate = (rating: Rating) => {
    if (!current) return;
    triggerHaptic();
    triggerClickSound(rating);
    setError(null);
    const songId = current.id;
    const songSnapshot = current;
    setEnterFrom(null);
    setExitRating(rating);
    setQueue((q) => q.slice(1));
    setLastAction({ song: songSnapshot, rating });
    startTransition(async () => {
      const result = await rateSong({ songId, rating });
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        setLastAction(null);
      }
    });
  };

  const handleSkip = () => {
    if (!current) return;
    triggerHaptic();
    setError(null);
    const songId = current.id;
    const songSnapshot = current;
    setEnterFrom(null);
    setExitRating(null);
    setQueue((q) => q.slice(1));
    setLastAction({ song: songSnapshot, rating: "skip" });
    startTransition(async () => {
      const result = await markSkipped(songId);
      if (!result.ok) {
        setError(result.error ?? "スキップの保存に失敗しました");
        setLastAction(null);
      }
    });
  };

  const handleUndo = () => {
    if (!lastAction) return;
    setError(null);
    const { song, rating } = lastAction;
    setLastAction(null);
    setEnterFrom(rating);
    setExitRating("instant");
    setQueue((q) => [song, ...q]);
    startTransition(async () => {
      const result = await unrateSong(song.id);
      if (!result.ok) {
        setError(result.error ?? "戻す操作に失敗しました");
      }
    });
  };

  if (!current) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">このデッキは終了しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ページを再読込すると次の 20 曲が表示されます。
        </p>
        <Button onClick={() => window.location.reload()}>次のデッキへ</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 overflow-hidden px-4 py-6">
      {/* 次の 2 枚のジャケット画像を裏で先読み */}
      {queue.slice(1, 3).map((song) => {
        const preloadSrc = song.image_url_large ?? song.image_url_medium;
        return preloadSrc ? (
          <link
            key={`preload-${song.id}`}
            rel="preload"
            as="image"
            href={preloadSrc}
          />
        ) : null;
      })}

      {error ? (
        <div className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {/* カードサイズ: 通常 22rem 幅 × 30rem 高、画面が狭ければ比率を保ちつつ縮小 */}
      {/* width = min(22rem, 利用可能高さ × 22/30) で、aspect-ratio により height は自動算出 */}
      <div
        className="relative"
        style={{
          aspectRatio: "22 / 30",
          width:
            "min(22rem, calc((100svh - 23rem - env(safe-area-inset-bottom)) * 22 / 30))",
        }}
      >
        {/* 後ろのカード (next 1, next 2): 中身も描画して、スワイプ中に
            真っ白な空のカードが見えてしまう問題を解消 */}
        {upcoming.map((song, idx) => (
          <div
            key={song.id}
            className="absolute inset-0 overflow-hidden rounded-2xl bg-white shadow-sm dark:bg-zinc-900"
            style={{
              transform: `translateY(${(idx + 1) * 8}px) scale(${1 - (idx + 1) * 0.04})`,
              zIndex: -idx - 1,
              opacity: 1 - (idx + 1) * 0.15,
            }}
          >
            <SongCardContent song={song} isKnown={knownSet.has(song.id)} />
            <GlassFrame>
              <SongCardContent song={song} isKnown={knownSet.has(song.id)} />
            </GlassFrame>
          </div>
        ))}

        {/* 先頭カード (ドラッグ可能) */}
        <AnimatePresence mode="popLayout" custom={exitRating}>
          <SwipeCard
            key={current.id}
            song={current}
            isKnown={knownSet.has(current.id)}
            enterFrom={enterFrom}
            onSwipeLeft={() => handleRate("hard")}
            onSwipeRight={() => handleRate("easy")}
            onSwipeUp={() => handleRate("medium")}
            onSwipeDown={() => handleRate("practicing")}
          />
        </AnimatePresence>
      </div>

      {/* 4 評価ボタン (丸いアイコンボタン + ラベル)
          トラック幅は size-14 の円幅 (3.5rem) ぴったりに合わせ、余白は
          justify-between で円と円の間に分配する。これにより下段
          col-span-3 のスキップが「苦手の左端〜得意の右端」と完全一致する。 */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            disabled={!current}
            onClick={() => handleRate(r.value)}
            className="flex flex-col items-center gap-1.5 transition disabled:opacity-50"
            aria-label={r.label}
          >
            <span
              className={`flex size-14 items-center justify-center rounded-full text-white shadow-sm transition ${r.color}`}
            >
              <r.Icon className="size-6" />
            </span>
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              {r.label}
            </span>
          </button>
        ))}
      </div>

      {/* 知らない/スキップ (col-span-3, 苦手〜得意の列幅) + 戻る (col-span-1, 練習中の列) */}
      {/* 上段と同じ grid (3.5rem ×4 + justify-between) で円位置に揃える */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        <button
          type="button"
          onClick={handleSkip}
          disabled={!current}
          // 視覚的に上段の 3 円と同じ幅に見えるよう、-mx-1 で左右 4px ずつ拡張。
          className="col-span-3 -mx-1 h-14 rounded-full bg-zinc-100 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-30 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          知らない / スキップ
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={!lastAction}
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-30 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          aria-label="直前の評価を取り消して戻る"
        >
          <Undo2 className="size-5" />
        </button>
      </div>
    </div>
  );
}

interface SwipeCardProps {
  song: Song;
  isKnown?: boolean;
  /** undo で復活した時の出発方向 (前回 exit した方向) */
  enterFrom?: Rating | null;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
  onSwipeDown: () => void;
}

function SwipeCard({
  song,
  isKnown = false,
  enterFrom = null,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
}: SwipeCardProps) {
  // enterFrom が指定されていれば、その方向の画面外位置で初期化し
  // マウント直後に 0 へアニメーションして「逆再生スライドイン」を実現。
  const initialX =
    enterFrom === "hard"
      ? -SWIPE_OUT_DISTANCE
      : enterFrom === "easy"
        ? SWIPE_OUT_DISTANCE
        : 0;
  const initialY =
    enterFrom === "medium"
      ? -SWIPE_OUT_DISTANCE
      : enterFrom === "practicing"
        ? SWIPE_OUT_DISTANCE
        : 0;
  const x = useMotionValue(initialX);
  const y = useMotionValue(initialY);

  useEffect(() => {
    if (initialX === 0 && initialY === 0) return;
    const t = { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const };
    const ax = animate(x, 0, t);
    const ay = animate(y, 0, t);
    return () => {
      ax.stop();
      ay.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);

  // スワイプ強度 (0〜1)。x/y が SWIPE_THRESHOLD に近づくほど 1 に
  const intensity = useTransform([x, y], ([xv, yv]) =>
    Math.min(
      1,
      Math.max(Math.abs(xv as number), Math.abs(yv as number)) / 150,
    ),
  );

  // スワイプ中はカード背面 (ジャケ画像 + テキスト) を
  //   - 明るく (brightness 1.00 → 1.35)
  //   - 彩度を少しだけ下げ (saturate 1.00 → 0.85)
  //   - ぼかす (blur 0 → 3px)
  // ことで、上に重なる「苦手」「得意」等のラベル文字のコントラストを稼ぐ。
  // この filter は SwipeOverlay には掛けない (ラベル自体がボケては本末転倒なため)。
  const filter = useTransform(intensity, (i) => {
    const t = i as number;
    return `brightness(${1 + t * 0.35}) saturate(${1 - t * 0.15}) blur(${t * 3}px)`;
  });

  // box-shadow: スワイプ方向に応じた色のハロー (blur が広がる) を演出
  // blur 半径とアルファが intensity に比例して強まる
  const boxShadow = useTransform([x, y], ([xv, yv]) => {
    const xn = xv as number;
    const yn = yv as number;
    const ax = Math.abs(xn);
    const ay = Math.abs(yn);
    const i = Math.min(1, Math.max(ax, ay) / 150);
    if (i < 0.05) {
      return "0 4px 12px rgba(0,0,0,0.08)";
    }
    let r = 0,
      g = 0,
      b = 0;
    if (ax > ay) {
      // 横方向: 右=得意(emerald) / 左=苦手(red)
      if (xn > 0) {
        r = 16;
        g = 185;
        b = 129;
      } else {
        r = 239;
        g = 68;
        b = 68;
      }
    } else {
      // 縦方向: 上=普通(yellow) / 下=練習中(purple)
      if (yn < 0) {
        r = 234;
        g = 179;
        b = 8;
      } else {
        r = 168;
        g = 85;
        b = 247;
      }
    }
    const blurPx = i * 50;
    const alpha = i * 0.55;
    return `0 0 ${blurPx}px rgba(${r},${g},${b},${alpha})`;
  });

  const overlayOpacity = useTransform(
    [x, y],
    ([xv, yv]) =>
      Math.min(
        1,
        Math.max(Math.abs(xv as number), Math.abs(yv as number)) / 150,
      ),
  );

  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo,
  ) => {
    const { offset } = info;
    const ax = Math.abs(offset.x);
    const ay = Math.abs(offset.y);
    if (Math.max(ax, ay) < SWIPE_THRESHOLD) {
      x.set(0);
      y.set(0);
      return;
    }
    if (ax > ay) {
      offset.x > 0 ? onSwipeRight() : onSwipeLeft();
    } else {
      offset.y > 0 ? onSwipeDown() : onSwipeUp();
    }
  };

  return (
    <motion.div
      style={{ x, y, rotate, boxShadow }}
      drag
      dragElastic={0.6}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      variants={SWIPE_EXIT_VARIANTS}
      exit="exit"
      whileTap={{ cursor: "grabbing" }}
      className="absolute inset-0 cursor-grab touch-none select-none overflow-hidden rounded-2xl bg-white dark:bg-zinc-900"
    >
      {/* filter はカード背面 (画像 + テキスト) のみに適用。
          SwipeOverlay (ラベル) はこの外側に置いて影響を受けないようにする */}
      <motion.div className="absolute inset-0" style={{ filter }}>
        <SongCardContent song={song} isKnown={isKnown} />
      </motion.div>
      <GlassFrame innerFilter={filter}>
        <SongCardContent song={song} isKnown={isKnown} />
      </GlassFrame>
      <SwipeOverlay x={x} y={y} opacity={overlayOpacity} />
    </motion.div>
  );
}

function SongCardContent({
  song,
  isKnown = false,
}: {
  song: Song;
  isKnown?: boolean;
}) {
  return (
    <div className="flex h-full flex-col">
      {/* 「Spotify で聴いたことある」バッジ: カード左上 */}
      {isKnown ? (
        <div
          className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm backdrop-blur"
          aria-label="Spotify で聴いたことがある曲"
        >
          <Headphones className="size-3" aria-hidden />
          聴いたことある
        </div>
      ) : null}

      {/* ジャケット: カード上部に edge-to-edge で配置 (余白なし) */}
      <div className="relative aspect-square w-full shrink-0 bg-zinc-200 dark:bg-zinc-800">
        {song.image_url_large ?? song.image_url_medium ? (
          <Image
            src={(song.image_url_large ?? song.image_url_medium)!}
            alt={`${song.title} のジャケット`}
            fill
            sizes="22rem"
            priority
            className="object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-zinc-400">
            ♪
          </div>
        )}
      </div>

      {/* テキスト領域: 画像下に padding を取って配置。背景はジャケットを上下反転＋強ブラー＋減光した画像 */}
      <div className="relative flex flex-1 flex-col justify-between gap-2 overflow-hidden p-3">
        {song.image_url_large ?? song.image_url_medium ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-0 scale-y-[-1] scale-x-110 brightness-[0.55] blur-2xl"
          >
            <Image
              src={(song.image_url_large ?? song.image_url_medium)!}
              alt=""
              fill
              sizes="22rem"
              className="object-cover"
              draggable={false}
            />
          </div>
        ) : null}

        <div className="relative z-10 w-full">
          <h2 className="line-clamp-1 text-lg font-semibold text-white drop-shadow-sm">
            <Link
              href={`/songs/${song.id}`}
              onPointerDown={(e) => e.stopPropagation()}
              draggable={false}
              className="hover:underline"
            >
              {song.title}
            </Link>
          </h2>
          <p className="text-xs text-zinc-200 drop-shadow-sm">
            {song.artist_id ? (
              <Link
                href={`/artists/${song.artist_id}`}
                onPointerDown={(e) => e.stopPropagation()}
                draggable={false}
                className="hover:underline"
              >
                {song.artist}
              </Link>
            ) : (
              song.artist
            )}
            {song.release_year ? ` · ${song.release_year}` : ""}
          </p>
        </div>

        {/* 音域情報 (Plan A: 背景なし、左寄せ、grid-cols-[auto_1fr] で 2 行を縦に揃える) */}
        <dl className="relative z-10 grid w-full grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
          <dt className="text-zinc-300">地声</dt>
          <dd className="font-mono text-zinc-100">
            {midiToKaraoke(song.range_low_midi)} 〜{" "}
            {midiToKaraoke(song.range_high_midi)}
          </dd>
          <dt className="text-zinc-300">裏声</dt>
          <dd className="font-mono text-zinc-100">
            {midiToKaraoke(song.falsetto_max_midi)}
          </dd>
        </dl>
      </div>

      {/* Spotify 再生ボタン: カード右下角に outlined 円形ボタン */}
      {song.spotify_track_id ? (
        <a
          href={`https://open.spotify.com/track/${song.spotify_track_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          draggable={false}
          className="absolute bottom-3 right-3 z-20 flex size-10 items-center justify-center rounded-full border-2 border-emerald-500 bg-white text-emerald-600 transition hover:bg-emerald-50 active:bg-emerald-100 dark:bg-zinc-900 dark:text-emerald-400 dark:hover:bg-emerald-950 dark:active:bg-emerald-900"
          aria-label={`${song.title} を Spotify で再生(新しいタブで開きます)`}
        >
          <Play className="size-4 fill-current" />
        </a>
      ) : null}
    </div>
  );
}

/**
 * カード内側 3px のリングだけを backdrop-filter で明るく+強くぼかして
 * ガラス風の枠線に見せる。
 *
 * 実装: 全面に backdrop-filter を当てた要素 (Layer 2) の上に、3px だけ内側に
 * 入った rounded-[13px] の同じ中身 (children) を重ねて中央を覆い隠す
 * (Layer 3)。結果として 3px の rounded リングだけがガラスとして残る。
 * 親が rounded-2xl (16px) なので 16 - 3 = 13 で curve が同心円になる。
 *
 * 単一要素 + mask-composite はもっと素直だが iOS Safari の transform 中に
 * 破綻するので採用しない。4 本のストリップ方式は親の rounded-2xl の
 * curve に角が沿わない (直角の集合なので) ため不採用。
 *
 * Layer 3 (中央の覆い) には Layer 1 と同じ filter を渡してスワイプ時の
 * 見え方を一致させる。
 */
function GlassFrame({
  children,
  innerFilter,
}: {
  children: React.ReactNode;
  innerFilter?: ReturnType<typeof useTransform<number, string>>;
}) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background: "rgba(255,255,255,0.28)",
          backdropFilter: "blur(20px) brightness(1.4) saturate(1.5)",
          WebkitBackdropFilter: "blur(20px) brightness(1.4) saturate(1.5)",
        }}
      />
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-[3px] overflow-hidden rounded-[13px]"
        style={innerFilter ? { filter: innerFilter } : undefined}
      >
        {children}
      </motion.div>
    </>
  );
}

interface SwipeOverlayProps {
  x: ReturnType<typeof useMotionValue<number>>;
  y: ReturnType<typeof useMotionValue<number>>;
  opacity: ReturnType<typeof useTransform<number, number>>;
}

function SwipeOverlay({ x, y, opacity }: SwipeOverlayProps) {
  const easyOpacity = useTransform([x, y], ([xv, yv]) =>
    (xv as number) > 0 && Math.abs(xv as number) > Math.abs(yv as number)
      ? 1
      : 0,
  );
  const hardOpacity = useTransform([x, y], ([xv, yv]) =>
    (xv as number) < 0 && Math.abs(xv as number) > Math.abs(yv as number)
      ? 1
      : 0,
  );
  // 上=普通, 下=練習中 に変更
  const mediumOpacity = useTransform([x, y], ([xv, yv]) =>
    (yv as number) < 0 && Math.abs(yv as number) > Math.abs(xv as number)
      ? 1
      : 0,
  );
  const practicingOpacity = useTransform([x, y], ([xv, yv]) =>
    (yv as number) > 0 && Math.abs(yv as number) > Math.abs(xv as number)
      ? 1
      : 0,
  );

  return (
    <motion.div
      className="pointer-events-none absolute inset-0 rounded-2xl"
      style={{ opacity }}
    >
      <motion.div
        style={{ opacity: easyOpacity }}
        className="absolute left-4 top-4 rounded-lg border-4 border-emerald-400 px-3 py-1 text-lg font-bold text-emerald-600"
      >
        得意
      </motion.div>
      <motion.div
        style={{ opacity: hardOpacity }}
        className="absolute right-4 top-4 rounded-lg border-4 border-red-400 px-3 py-1 text-lg font-bold text-red-600"
      >
        苦手
      </motion.div>
      <motion.div
        style={{ opacity: mediumOpacity }}
        className="absolute bottom-[40%] left-1/2 -translate-x-1/2 rounded-lg border-4 border-yellow-400 px-3 py-1 text-lg font-bold text-yellow-600"
      >
        普通
      </motion.div>
      <motion.div
        style={{ opacity: practicingOpacity }}
        className="absolute left-1/2 top-[40%] -translate-x-1/2 rounded-lg border-4 border-purple-400 px-3 py-1 text-lg font-bold text-purple-600"
      >
        練習中
      </motion.div>
    </motion.div>
  );
}

"use client";

import {
  AnimatePresence,
  motion,
  type PanInfo,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { Bookmark, Check, Minus, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import { startTransition, useState } from "react";

import { Button } from "@/components/ui/button";
import { midiToKaraoke } from "@/lib/note";
import type { Database } from "@/types/database";

import { rateSong, unrateSong } from "./actions";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type Rating = Database["public"]["Enums"]["rating_type"];

/**
 * 直前のアクション。「戻る」で取り消すために保持する。
 * - rating !== null: rateSong を実行済み → unrateSong で取り消し
 * - rating === null: スキップ(DB書き込みなし)→ queue に戻すだけ
 */
type LastAction = { song: Song; rating: Rating | null };

interface SwipeDeckProps {
  initialSongs: Song[];
}

const SWIPE_THRESHOLD = 110;

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
    color: "bg-red-500 hover:bg-red-600 active:bg-red-700",
  },
  {
    value: "medium",
    label: "普通",
    Icon: Minus,
    color: "bg-zinc-500 hover:bg-zinc-600 active:bg-zinc-700",
  },
  {
    value: "easy",
    label: "得意",
    Icon: Check,
    color: "bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700",
  },
  {
    value: "practicing",
    label: "練習中",
    Icon: Bookmark,
    color: "bg-amber-500 hover:bg-amber-600 active:bg-amber-700",
  },
];

export function SwipeDeck({ initialSongs }: SwipeDeckProps) {
  const [queue, setQueue] = useState(initialSongs);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];
  const upcoming = queue.slice(1, 3);

  const handleRate = (rating: Rating) => {
    if (!current) return;
    setError(null);
    const songId = current.id;
    const songSnapshot = current;
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
    setError(null);
    const songSnapshot = current;
    setQueue((q) => q.slice(1));
    setLastAction({ song: songSnapshot, rating: null });
  };

  const handleUndo = () => {
    if (!lastAction) return;
    setError(null);
    const { song, rating } = lastAction;
    setLastAction(null);
    setQueue((q) => [song, ...q]);
    if (rating === null) return;
    startTransition(async () => {
      const result = await unrateSong(song.id);
      if (!result.ok) {
        setError(result.error ?? "戻す操作に失敗しました");
      }
    });
  };

  if (!current) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">このデッキは終了しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ページを再読込すると次の 20 曲が表示されます。
        </p>
        <Button onClick={() => window.location.reload()}>次のデッキへ</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-5 px-4 py-6">
      {/* 次の 2 枚のジャケット画像を裏で先読み */}
      {queue.slice(1, 3).map((song) =>
        song.image_url_medium ? (
          <link
            key={`preload-${song.id}`}
            rel="preload"
            as="image"
            href={song.image_url_medium}
          />
        ) : null,
      )}

      {error ? (
        <div className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="relative h-[28rem] w-full">
        {/* 後ろのカード (next 1, next 2) */}
        {upcoming.map((song, idx) => (
          <div
            key={song.id}
            className="absolute inset-0 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            style={{
              transform: `translateY(${(idx + 1) * 8}px) scale(${1 - (idx + 1) * 0.04})`,
              zIndex: -idx - 1,
              opacity: 1 - (idx + 1) * 0.15,
            }}
          />
        ))}

        {/* 先頭カード (ドラッグ可能) */}
        <AnimatePresence mode="popLayout">
          <SwipeCard
            key={current.id}
            song={current}
            onSwipeLeft={() => handleRate("hard")}
            onSwipeRight={() => handleRate("easy")}
            onSwipeUp={() => handleRate("practicing")}
            onSwipeDown={() => handleRate("medium")}
          />
        </AnimatePresence>
      </div>

      {/* 4 評価ボタン (丸いアイコンボタン + ラベル) */}
      <div className="grid w-full grid-cols-4 gap-2">
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
      {/* 上の評価ボタン行と同じ grid-cols-4/gap-2 で列を揃える */}
      <div className="grid w-full grid-cols-4 gap-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={!current}
          className="col-span-3 h-14 rounded-full bg-zinc-100 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-30 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
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
          <RotateCcw className="size-5" />
        </button>
      </div>
    </div>
  );
}

interface SwipeCardProps {
  song: Song;
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  onSwipeUp: () => void;
  onSwipeDown: () => void;
}

function SwipeCard({
  song,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown,
}: SwipeCardProps) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-15, 0, 15]);

  // スワイプ強度 (0〜1)。x/y が SWIPE_THRESHOLD に近づくほど 1 に
  const intensity = useTransform([x, y], ([xv, yv]) =>
    Math.min(
      1,
      Math.max(Math.abs(xv as number), Math.abs(yv as number)) / 150,
    ),
  );

  // 明度: スワイプ中はカード自体が 1.00 → 1.12 に明るくなる (subtle な「光る」感)
  const filter = useTransform(
    intensity,
    (i) => `brightness(${1 + (i as number) * 0.12})`,
  );

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
      // 縦方向: 上=練習中(amber) / 下=普通(zinc)
      if (yn < 0) {
        r = 245;
        g = 158;
        b = 11;
      } else {
        r = 113;
        g = 113;
        b = 122;
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
      style={{ x, y, rotate, filter, boxShadow }}
      drag
      dragElastic={0.6}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.15 } }}
      whileTap={{ cursor: "grabbing" }}
      className="absolute inset-0 cursor-grab touch-none select-none rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <SongCardContent song={song} />
      <SwipeOverlay x={x} y={y} opacity={overlayOpacity} />
    </motion.div>
  );
}

function SongCardContent({ song }: { song: Song }) {
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      {/* ジャケット (中央) */}
      <div className="relative aspect-square w-full max-w-[14rem] self-center overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
        {song.image_url_medium ? (
          <Image
            src={song.image_url_medium}
            alt={`${song.title} のジャケット`}
            fill
            sizes="14rem"
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

      {/* 曲名 + アーティスト・発売年 (左寄せ) */}
      <div className="w-full">
        <h2 className="line-clamp-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {song.title}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {song.artist}
          {song.release_year ? ` · ${song.release_year}` : ""}
        </p>
      </div>

      {/* 音域情報 */}
      <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
        <dt className="text-zinc-600 dark:text-zinc-400">地声</dt>
        <dd className="text-right font-mono">
          {midiToKaraoke(song.range_low_midi)} 〜{" "}
          {midiToKaraoke(song.range_high_midi)}
        </dd>
        <dt className="text-zinc-600 dark:text-zinc-400">裏声</dt>
        <dd className="text-right font-mono">
          {midiToKaraoke(song.falsetto_max_midi)}
        </dd>
      </dl>

      {/* Spotify 試聴ボタン (音域の下、中央配置) */}
      {song.spotify_track_id ? (
        <a
          href={`https://open.spotify.com/track/${song.spotify_track_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onPointerDown={(e) => e.stopPropagation()}
          draggable={false}
          className="inline-flex items-center justify-center gap-1.5 self-center rounded-full border border-emerald-500 px-4 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-50 active:bg-emerald-100 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950 dark:active:bg-emerald-900"
          aria-label={`${song.title} を Spotify で聴く(新しいタブで開きます)`}
        >
          <span aria-hidden>▶</span>
          Spotify で試聴
        </a>
      ) : null}
    </div>
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
  const practicingOpacity = useTransform([x, y], ([xv, yv]) =>
    (yv as number) < 0 && Math.abs(yv as number) > Math.abs(xv as number)
      ? 1
      : 0,
  );
  const mediumOpacity = useTransform([x, y], ([xv, yv]) =>
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
        style={{ opacity: practicingOpacity }}
        className="absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border-4 border-amber-400 px-3 py-1 text-lg font-bold text-amber-600"
      >
        練習中
      </motion.div>
      <motion.div
        style={{ opacity: mediumOpacity }}
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border-4 border-zinc-400 px-3 py-1 text-lg font-bold text-zinc-600"
      >
        普通
      </motion.div>
    </motion.div>
  );
}

"use client";

import {
  AnimatePresence,
  motion,
  type PanInfo,
  useMotionValue,
  useTransform,
} from "framer-motion";
import { useState, useTransition } from "react";

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
  emoji: string;
  color: string;
  hint: string;
}> = [
  {
    value: "hard",
    label: "苦手",
    emoji: "❌",
    color: "bg-red-500 hover:bg-red-600 text-white",
    hint: "← スワイプ",
  },
  {
    value: "medium",
    label: "普通",
    emoji: "△",
    color: "bg-zinc-500 hover:bg-zinc-600 text-white",
    hint: "↓",
  },
  {
    value: "easy",
    label: "得意",
    emoji: "⭕",
    color: "bg-emerald-500 hover:bg-emerald-600 text-white",
    hint: "→ スワイプ",
  },
  {
    value: "practicing",
    label: "練習中",
    emoji: "🔖",
    color: "bg-amber-500 hover:bg-amber-600 text-white",
    hint: "↑",
  },
];

export function SwipeDeck({ initialSongs }: SwipeDeckProps) {
  const [queue, setQueue] = useState(initialSongs);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const current = queue[0];
  const upcoming = queue.slice(1, 3);

  const handleRate = (rating: Rating) => {
    if (!current || isPending) return;
    setError(null);
    const songId = current.id;
    const songSnapshot = current;
    // 楽観的に front から外す
    setQueue((q) => q.slice(1));
    setLastAction({ song: songSnapshot, rating });
    startTransition(async () => {
      const result = await rateSong({ songId, rating });
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        // 失敗時は queue 先頭に戻す + undo 履歴も巻き戻す
        setQueue((q) => [songSnapshot, ...q]);
        setLastAction(null);
      }
    });
  };

  /**
   * 知らない曲などを評価せず次へ。DB 書き込みは行わない。
   * 「戻る」で取り消し可能。リロードすると再表示される(セッション内のみ非表示)。
   */
  const handleSkip = () => {
    if (!current || isPending) return;
    setError(null);
    const songSnapshot = current;
    setQueue((q) => q.slice(1));
    setLastAction({ song: songSnapshot, rating: null });
  };

  /**
   * 直前の評価/スキップを取り消す。queue 先頭に戻し、評価済みなら DB からも削除。
   */
  const handleUndo = () => {
    if (!lastAction || isPending) return;
    setError(null);
    const { song, rating } = lastAction;
    setLastAction(null);
    setQueue((q) => [song, ...q]);
    if (rating === null) return; // スキップなら DB 操作なし
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
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 px-4 py-6">
      {error ? (
        <div className="w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="relative h-[26rem] w-full">
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

      {/* 補助操作: 戻る / スキップ */}
      <div className="flex w-full items-center justify-between">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!lastAction || isPending}
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="直前の評価を取り消して戻る"
        >
          <span aria-hidden>↺</span>
          <span>戻る</span>
        </button>
        <button
          type="button"
          onClick={handleSkip}
          disabled={!current || isPending}
          className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-zinc-600 transition hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-zinc-400 dark:hover:bg-zinc-800"
          aria-label="この曲を評価せずスキップ"
        >
          <span>知らない / スキップ</span>
          <span aria-hidden>↷</span>
        </button>
      </div>

      {/* 4 択ボタン */}
      <div className="grid w-full grid-cols-4 gap-2">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            disabled={isPending}
            onClick={() => handleRate(r.value)}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-medium transition disabled:opacity-50 ${r.color}`}
          >
            <span className="text-xl">{r.emoji}</span>
            {r.label}
          </button>
        ))}
      </div>

      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        スワイプ: ← 苦手 / → 得意 / ↑ 練習中 / ↓ 普通
      </p>
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
  const overlayOpacity = useTransform(
    [x, y],
    ([xv, yv]) => Math.min(1, Math.max(Math.abs(xv as number), Math.abs(yv as number)) / 150),
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
      style={{ x, y, rotate }}
      drag
      dragElastic={0.6}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.9, opacity: 0, transition: { duration: 0.15 } }}
      whileTap={{ cursor: "grabbing" }}
      className="absolute inset-0 cursor-grab touch-none select-none rounded-2xl border border-zinc-200 bg-white p-4 shadow-md dark:border-zinc-800 dark:bg-zinc-900"
    >
      <SongCardContent song={song} />
      <SwipeOverlay x={x} y={y} opacity={overlayOpacity} />
    </motion.div>
  );
}

function SongCardContent({ song }: { song: Song }) {
  return (
    <div className="flex h-full flex-col items-center justify-between gap-3">
      <div className="aspect-square w-full max-w-[16rem] overflow-hidden rounded-xl bg-zinc-200 dark:bg-zinc-800">
        {song.image_url_medium ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={song.image_url_medium}
            alt={`${song.title} のジャケット`}
            className="h-full w-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl text-zinc-400">
            ♪
          </div>
        )}
      </div>

      <div className="w-full text-center">
        <h2 className="line-clamp-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          {song.title}
        </h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {song.artist}
          {song.release_year ? ` · ${song.release_year}` : ""}
        </p>
      </div>

      <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-zinc-100 px-3 py-2 text-xs dark:bg-zinc-800">
        <dt className="text-zinc-600 dark:text-zinc-400">地声</dt>
        <dd className="text-right font-mono">
          {midiToKaraoke(song.range_low_midi)} 〜 {midiToKaraoke(song.range_high_midi)}
        </dd>
        <dt className="text-zinc-600 dark:text-zinc-400">裏声</dt>
        <dd className="text-right font-mono">
          {midiToKaraoke(song.falsetto_max_midi)}
        </dd>
      </dl>
    </div>
  );
}

interface SwipeOverlayProps {
  x: ReturnType<typeof useMotionValue<number>>;
  y: ReturnType<typeof useMotionValue<number>>;
  opacity: ReturnType<typeof useTransform<number, number>>;
}

function SwipeOverlay({ x, y, opacity }: SwipeOverlayProps) {
  // 各方向の表示タイミングをモーション値で導出 (フックは loop しない)
  const easyOpacity = useTransform([x, y], ([xv, yv]) =>
    (xv as number) > 0 && Math.abs(xv as number) > Math.abs(yv as number) ? 1 : 0,
  );
  const hardOpacity = useTransform([x, y], ([xv, yv]) =>
    (xv as number) < 0 && Math.abs(xv as number) > Math.abs(yv as number) ? 1 : 0,
  );
  const practicingOpacity = useTransform([x, y], ([xv, yv]) =>
    (yv as number) < 0 && Math.abs(yv as number) > Math.abs(xv as number) ? 1 : 0,
  );
  const mediumOpacity = useTransform([x, y], ([xv, yv]) =>
    (yv as number) > 0 && Math.abs(yv as number) > Math.abs(xv as number) ? 1 : 0,
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

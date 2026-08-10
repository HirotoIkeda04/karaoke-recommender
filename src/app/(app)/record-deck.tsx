"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  FastForward,
  Minus,
  Play,
  SkipForward,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useRef, useState } from "react";

import { DumbbellMini } from "@/components/icons/dumbbell-mini";
import { Button } from "@/components/ui/button";
import { JacketImage } from "@/components/ui/jacket-image";
import { triggerHaptic } from "@/lib/haptics";
import { triggerRatingSound } from "@/lib/rating-sound";
import type { Database } from "@/types/database";

import { markSkipped, rateSong, unrateSong } from "./actions";

type Song = Database["public"]["Tables"]["songs"]["Row"];
type Rating = Database["public"]["Enums"]["rating_type"];

/**
 * レコード 1 周の時間 (ms) = 1 曲の表示時間。
 * 回転アニメーション (globals.css の record-spin) の周期であり、
 * animationiteration イベント経由で次の曲への自動送りも司る。
 * 試聴もこの周期に合わせた頭出しスニペット (曲送りで音源ごと切替)。
 */
const ROTATION_MS = 6000;

/** スニペット終端のフェードアウト長 (秒)。iOS Safari は volume 変更が
 *  効かないため、そこではハードカットに劣化する (仕様)。 */
const AUDIO_FADE_SEC = 0.8;

/**
 * 再生アンロック用の極小無音 WAV。iOS Safari は「ユーザー操作中に play()
 * した <audio> 要素」だけが以後のプログラム再生を許可されるため、タップ時
 * に音源が無い曲でもこれを一度鳴らして要素をアンロックしておく。
 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

/**
 * ディスク径。横幅いっぱい (左右 1.75rem マージン) を基本に、
 * 縦に収まらない小さい画面ではヘッダー + 組カルーセル + 曲情報 +
 * ボタン群 + ナビの予約分 (約 31.5rem) を引いた残りへ縮める。上限 20rem。
 * loading.tsx の skeleton と式を揃えること。
 */
const DISC_SIZE =
  "min(20rem, calc(100vw - 3.5rem), max(8rem, calc(100svh - 31.5rem - env(safe-area-inset-bottom))))";

/**
 * カルーセルの隣接ディスク間隔 (自身の幅に対する %)。
 * 100% 未満にして前後のディスクを画面端から覗かせ、カルーセルであることを
 * 見せる (scale 0.7 縮小と z-index 層で、現在の盤の後ろへ滑り込む)。
 */
const SLIDE_OFFSET_PERCENT = 80;

/** デッキ内の現在位置。group = 組 (アーティスト)、song = 組内の曲順 */
interface DeckPosition {
  group: number;
  song: number;
}

/**
 * 直前のユーザー操作。「戻る」で取り消すために保持する。
 * rating が null の場合はナビゲーションのみ (組スキップ) で、
 * undo は位置の復元だけを行う。それ以外は DB 行も削除する。
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
    Icon: DumbbellMini,
    color:
      "bg-[linear-gradient(135deg,#c084fc_0%,#a855f7_28%,#a855f7_72%,#7e22ce_100%)] hover:brightness-110 active:brightness-95",
  },
];

interface RecordDeckProps {
  /** 組 (同一アーティストの楽曲群) の配列。各組は [推薦シード, ...人気順] */
  initialGroups: Song[][];
}

export function RecordDeck({ initialGroups }: RecordDeckProps) {
  const [groups] = useState(initialGroups);
  const [position, setPosition] = useState<DeckPosition>({ group: 0, song: 0 });
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 試聴 ON/OFF (ユーザーの意思)。ON でも音源が無い曲は無音で回る。
  const [audioOn, setAudioOn] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 再生中の曲 id。タップ起点の再生と曲送り effect の二重再生を防ぐ。
  const playingSongIdRef = useRef<string | null>(null);

  const group = groups[position.group];
  const current = group?.[position.song];

  // AnimatePresence の退場ツリー (組遷移中 0.2 秒残る) のボタンは古い
  // props を凍結したままタップできてしまう。ハンドラが常に実状態で動ける
  // よう、最新の current / audioOn をコミット後に ref へ同期しておく。
  const currentRef = useRef(current);
  const audioOnRef = useRef(audioOn);
  useEffect(() => {
    currentRef.current = current;
    audioOnRef.current = audioOn;
  });

  // ホームにいる間は body スクロールをロック (回転中の誤スクロール防止)。
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  /** <audio> 要素を遅延生成する。スニペット終端はフェードアウト */
  const ensureAudio = (): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.preload = "auto";
    el.addEventListener("timeupdate", () => {
      const remain = ROTATION_MS / 1000 - el.currentTime;
      try {
        el.volume = remain < AUDIO_FADE_SEC ? Math.max(0, remain / AUDIO_FADE_SEC) : 1;
      } catch {
        // iOS Safari は volume 変更不可 (ハードカットに劣化)
      }
    });
    audioRef.current = el;
    return el;
  };

  const playSnippet = (audio: HTMLAudioElement, song: Song) => {
    const src = song.itunes_preview_url;
    playingSongIdRef.current = song.id;
    if (!src) {
      audio.pause();
      return;
    }
    audio.src = src;
    try {
      audio.volume = 1;
    } catch {
      /* iOS */
    }
    void audio.play().catch(() => {
      // 自動再生ブロック等。無音で回転は続くので UI は止めない
    });
  };

  // 曲が変わったら試聴音源を差し替える (タップ起点の再生分はスキップ)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audioOn || !audio) return;
    if (!current) {
      audio.pause();
      playingSongIdRef.current = null;
      return;
    }
    if (playingSongIdRef.current === current.id) return;
    playSnippet(audio, current);
     
  }, [audioOn, current]);

  // バックグラウンドでは試聴を止める。Android は放置すると裏で音が流れ
  // 続け、iOS は OS に止められた後で無音のままになるため、復帰時は
  // 現在の曲を頭から再生し直す (回転は次の周回で自然に再同期する)。
  useEffect(() => {
    const onVisibility = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (document.hidden) {
        audio.pause();
      } else if (audioOn && current) {
        playSnippet(audio, current);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
     
  }, [audioOn, current]);

  // アンマウント時に音を止める
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  /**
   * レコードタップで試聴の再生/停止を切り替える。
   * iOS Safari はユーザー操作中に play() した要素しか以後のプログラム再生を
   * 許さないため、初回タップでは必ずこのハンドラ内 (ジェスチャ文脈) で
   * play() を呼ぶ。音源が無い曲でも無音 WAV でアンロックしておく。
   * state は closure ではなく ref から読む (退場ツリーからの stale タップ対策)。
   */
  const handleToggleAudio = () => {
    const song = currentRef.current;
    if (!song) return;
    triggerHaptic();
    const audio = ensureAudio();
    if (audioOnRef.current) {
      audio.pause();
      playingSongIdRef.current = null;
      setAudioOn(false);
      return;
    }
    setAudioOn(true);
    if (song.itunes_preview_url) {
      playSnippet(audio, song);
    } else {
      playingSongIdRef.current = song.id;
      audio.src = SILENT_WAV;
      void audio.play().catch(() => {});
    }
  };

  /**
   * from の次の曲 (組の末尾なら次の組の先頭) へ進む。
   * AnimatePresence (mode="wait") の退場ツリーは古い props が凍結されたまま
   * 0.2 秒描画され続け、その間も旧ディスクの回転から stale な
   * animationiteration が届き得る。現在位置が from と一致する時だけ進める
   * ことで、組スキップ / undo 直後の上書きを防ぐ。
   */
  const advance = (from: DeckPosition) => {
    setPosition((p) => {
      if (p.group !== from.group || p.song !== from.song) return p;
      const g = groups[from.group];
      return g && from.song + 1 < g.length
        ? { group: from.group, song: from.song + 1 }
        : { group: from.group + 1, song: 0 };
    });
  };

  const handleRate = (rating: Rating) => {
    if (!current) return;
    triggerHaptic();
    triggerRatingSound(rating);
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
    setError(null);
    setLastAction({ position, song: current, rating: null });
    setPosition({ group: position.group + 1, song: 0 });
  };

  const handleUndo = () => {
    if (!lastAction) return;
    triggerHaptic();
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
  };

  if (!current) {
    return (
      <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">このデッキは終了しました 🎉</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          ページを再読込すると次の組が表示されます。
        </p>
        <Button
          onClick={() => window.location.reload()}
          size="lg"
          className="h-14 px-8 text-lg font-bold"
        >
          次のデッキへ
        </Button>
      </div>
    );
  }

  const nextGroup = groups[position.group + 1];

  // overflow-clip: transform で外側に置いた隣のディスクが overflow-hidden だと
  // スクロール可能領域を作ってしまい、フォーカス移動等の scrollIntoView で
  // レイアウト全体が横にずれる。clip はスクロール自体を不可能にする。
  return (
    <div className="relative mx-auto flex max-w-md select-none flex-col items-center gap-6 overflow-clip px-4 pb-2 pt-8">
      {/* 次の組の先頭ジャケットを裏で先読み (現在の組は全ディスクが即ロードされる) */}
      {(nextGroup ?? []).slice(0, 2).map((song) => {
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

      {/* バナーは overlay 配置 (flex フローに入れると縦予算 31.5rem が崩れ、
          下段ボタンが固定ナビの裏に隠れるため) */}
      {error ? (
        <div className="absolute inset-x-4 top-2 z-20 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {/* 組ごとのカルーセル: 各組のシード曲ジャケット。現在の組が中央に来る。
          組の切替アニメーションと独立させるため、下の AnimatePresence の外に置く */}
      <div
        role="group"
        aria-roledescription="カルーセル"
        aria-label="デッキ内の組"
        className="relative h-14 w-full"
      >
        {groups.map((groupSongs, index) => {
          const seed = groupSongs[0];
          if (!seed) return null;
          const delta = index - position.group;
          const isActive = delta === 0;
          const thumbSrc = seed.image_url_medium ?? seed.image_url_large;
          return (
            <motion.div
              key={seed.id}
              aria-hidden={!isActive}
              initial={false}
              animate={{
                x: `${delta * 130}%`,
                scale: isActive ? 1 : 0.8,
                opacity: Math.abs(delta) > 3 ? 0 : isActive ? 1 : 0.45,
              }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute left-1/2 top-0 -ml-7 size-14"
              style={{ zIndex: isActive ? 10 : 0 }}
            >
              {/* 角丸・枠線なしの素のジャケット。現在の組は scale と不透明度で示す */}
              <div className="relative size-full overflow-hidden bg-zinc-800">
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
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* 組単位で左へ流れる。中は曲単位のカルーセル + 曲情報 */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={position.group}
          initial={{ x: 72, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -72, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="flex w-full flex-col items-center gap-6"
        >
          {/* ジャケットのカルーセル (遷移ボタンなし。回転完了 or スキップで進む) */}
          <div
            role="group"
            aria-roledescription="カルーセル"
            aria-label="同じアーティストの楽曲"
            className="relative mx-auto"
            style={{ width: DISC_SIZE, height: DISC_SIZE }}
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
                    scale: isActive ? 1 : 0.7,
                    opacity: Math.abs(delta) > 1 ? 0 : isActive ? 1 : 0.45,
                  }}
                  transition={{ type: "spring", stiffness: 260, damping: 30 }}
                  className="absolute inset-0"
                  // 現在の盤を最前面に。隣の盤は縮小したまま端から覗き、
                  // スライド時は現在の盤の後ろへ滑り込む。
                  // タップは現在の盤だけが受ける (端から覗く盤は素通し)
                  style={{
                    zIndex: isActive ? 10 : Math.abs(delta) === 1 ? 5 : 0,
                    pointerEvents: isActive ? "auto" : "none",
                  }}
                >
                  <button
                    type="button"
                    onClick={isActive ? handleToggleAudio : undefined}
                    disabled={!isActive}
                    aria-label={
                      audioOn ? "試聴を停止する" : "この曲を試聴する"
                    }
                    className="block h-full w-full cursor-pointer"
                  >
                    <RecordDisc
                      song={song}
                      active={isActive}
                      showPlayHint={isActive && !audioOn}
                      onRotationEnd={() => advance(position)}
                    />
                  </button>
                </motion.div>
              );
            })}
          </div>

          {/* 曲順 + 楽曲名 / アーティスト名 */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={current.id}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full px-2 text-center"
            >
              <h2
                className="line-clamp-1 text-xl font-semibold"
                style={{
                  fontFamily:
                    '"LatinUpscale", var(--font-geist-sans), system-ui, sans-serif',
                }}
              >
                <span className="mr-2 font-mono text-base text-zinc-500 dark:text-zinc-400">
                  #{position.song + 1}
                </span>
                <Link href={`/songs/${current.id}`} className="hover:underline">
                  {current.title}
                </Link>
              </h2>
              <p className="mt-1 line-clamp-1 text-sm text-zinc-600 dark:text-zinc-400">
                {current.artist_id ? (
                  <Link
                    href={`/artists/${current.artist_id}`}
                    className="hover:underline"
                  >
                    {current.artist}
                  </Link>
                ) : (
                  current.artist
                )}
              </p>
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* 4 評価ボタン (丸いアイコンボタン + ラベル) */}
      <div className="grid w-full grid-cols-[repeat(4,3.5rem)] justify-around">
        {RATINGS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => handleRate(r.value)}
            className="flex flex-col items-center gap-1.5 transition"
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

      {/* スキップ 2 種 (同サイズ) + 戻る */}
      <div className="grid w-full grid-cols-[1fr_1fr_3.5rem] items-center gap-3">
        <button
          type="button"
          onClick={handleSkipSong}
          className="flex h-14 items-center justify-center gap-1.5 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <SkipForward className="size-4" aria-hidden />
          1曲スキップ
        </button>
        <button
          type="button"
          onClick={handleSkipGroup}
          className="flex h-14 items-center justify-center gap-1.5 rounded-full bg-zinc-100 text-sm font-medium text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <FastForward className="size-4" aria-hidden />
          次の組へ
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={!lastAction}
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition hover:bg-zinc-200 active:bg-zinc-300 disabled:opacity-30 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          aria-label="直前の操作を取り消して戻る"
        >
          <Undo2 className="size-5" />
        </button>
      </div>
    </div>
  );
}

interface RecordDiscProps {
  song: Song;
  /** 現在再生位置のディスクのみ回転し、1 周ごとに onRotationEnd を呼ぶ */
  active: boolean;
  /** 試聴 OFF の時に「タップで再生」の再生アイコンを中央に重ねる */
  showPlayHint?: boolean;
  onRotationEnd: () => void;
}

/**
 * ジャケット写真を表示時に CSS でレコード盤へ加工する。
 * 盤面全体にジャケットを敷き、溝 (同心円リング) / ラベル境界 / 光沢 /
 * センターホールをレイヤーで重ねる。回転体は正円なのでシルエットが
 * 不変であり、overflow-hidden との組み合わせでも輪郭が乱れない。
 * 光沢は光源固定に見せるため回転体の外に置く。
 */
function RecordDisc({
  song,
  active,
  showPlayHint = false,
  onRotationEnd,
}: RecordDiscProps) {
  const src = song.image_url_large ?? song.image_url_medium;
  return (
    <div className="relative h-full w-full">
      {/* 回転体: ジャケット + 溝 + ラベル境界 */}
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          animation: active
            ? `record-spin ${ROTATION_MS}ms linear infinite`
            : "none",
        }}
        onAnimationIteration={active ? onRotationEnd : undefined}
      >
        {src ? (
          <JacketImage
            src={src}
            alt={`${song.title} のジャケット`}
            fill
            sizes="19rem"
            loading="eager"
            className="object-cover brightness-[0.92] saturate-[0.95]"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-4xl text-zinc-500">
            ♪
          </div>
        )}
        {/* 溝: 1px 間隔の同心円リング。ラベル部 (中心 28%) と最外周は mask で除く */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "repeating-radial-gradient(circle at center, rgba(0,0,0,0.42) 0px, rgba(0,0,0,0.42) 0.8px, rgba(255,255,255,0.05) 1.6px, rgba(0,0,0,0.16) 2.6px, rgba(0,0,0,0.16) 4px)",
            maskImage:
              "radial-gradient(circle closest-side at center, transparent 0%, transparent 26%, black 30%, black 96%, transparent 99%)",
            WebkitMaskImage:
              "radial-gradient(circle closest-side at center, transparent 0%, transparent 26%, black 30%, black 96%, transparent 99%)",
          }}
        />
        {/* ラベルの外周リング */}
        <div
          aria-hidden
          className="absolute rounded-full border border-white/25"
          style={{ inset: "36%" }}
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
      {/* 「タップで試聴」ヒント。再生中は消してレコードだけ見せる */}
      {showPlayHint ? (
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play className="ml-0.5 size-5 fill-current" />
          </span>
        </div>
      ) : null}
    </div>
  );
}

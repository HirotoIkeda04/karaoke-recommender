"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  FastForward,
  Minus,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
 * 見せる (scale 0.65 縮小と z-index 層で、現在の盤の後ろへ滑り込む)。
 */
const SLIDE_OFFSET_PERCENT = 80;

/**
 * 組カルーセルの間隔 (サムネイル幅に対する %)。中央から外側へ向かう
 * 区間ごとの間隔で、中央ほど疎 (現行の 130%)、外側ほど密に詰める。
 */
const GROUP_THUMB_GAPS = [130, 100, 82, 70] as const;

/** 組サムネイルの中央からのオフセット (%)。区間幅を累積する */
function groupThumbOffset(delta: number): number {
  let x = 0;
  for (let i = 0; i < Math.abs(delta); i++) {
    x += GROUP_THUMB_GAPS[Math.min(i, GROUP_THUMB_GAPS.length - 1)];
  }
  return Math.sign(delta) * x;
}

/**
 * 組サムネイルの Y 軸傾き (deg)。カバーフロー風に、中央は正面 (0°)、
 * 外側へ行くほど中央を向いて傾き、端はほぼ真横 (80° = 背表紙状の側面)。
 */
const GROUP_THUMB_TILTS = [0, 32, 58, 80] as const;

/** 組サムネイルの厚み (px)。preserve-3d の側面としてレンダリングされる */
const GROUP_THUMB_DEPTH_PX = 4;

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

/** カバーが「引き出され始めた」とみなすスクロール露出量 (px)。回転送り抑制用 */
const COVER_ENGAGE_PX = 8;

export function RecordDeck({ initialGroups }: RecordDeckProps) {
  const router = useRouter();
  const pathname = usePathname();
  // RecordDeck はホーム (/) でのみマウントされるので、マウントされたまま
  // pathname が /songs/[id] になっていれば、楽曲ページ/シートが上に
  // 開いている (intercepting route) と判定できる。
  const sheetOpen = /^\/songs\/[^/]+\/?$/.test(pathname);
  const [groups] = useState(initialGroups);
  const [position, setPosition] = useState<DeckPosition>({ group: 0, song: 0 });
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 試聴 ON/OFF (ユーザーの意思)。デフォルト ON。ON でも音源が無い曲は
  // 無音で回る。ブラウザに自動再生をブロックされた場合は
  // needsGestureRetryRef を立て、最初の画面操作で再生を再試行する。
  const [audioOn, setAudioOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 再生中の曲 id。タップ起点の再生と曲送り effect の二重再生を防ぐ。
  const playingSongIdRef = useRef<string | null>(null);
  const needsGestureRetryRef = useRef(false);
  // 楽曲ページが開いている間のフル尺再生モード (6 秒フェード/カット無効)。
  // handleOpenSongPage で立ててから遷移するため「遷移待ちの間」も true。
  const fullModeRef = useRef(false);
  // 下ドラッグ中フラグ。ドラッグ最中の回転一周で勝手に曲が進むのを防ぐ
  const dragActiveRef = useRef(false);

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
      // フル尺モード (楽曲ページ表示中) はフェード/カットせず最後まで流す
      if (fullModeRef.current) return;
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
    void audio.play().then(
      () => {
        needsGestureRetryRef.current = false;
      },
      (err: unknown) => {
        // pause() や src 差し替えによる自己中断 (AbortError) は正常系なので
        // 無視する。自動再生ブロック (NotAllowedError) の時だけ、次の
        // ユーザー操作 (ジェスチャ文脈) での再試行を予約する。
        if ((err as DOMException)?.name === "NotAllowedError") {
          needsGestureRetryRef.current = true;
        }
      },
    );
  };

  // 自動再生がブロックされた場合の復帰: 最初の画面操作 (どこでも) の
  // ジェスチャ文脈内で play() し直す。pointerdown で活性化しない環境の
  // ために click でも試み、成功するまでフラグは playSnippet 側で立ち直る。
  useEffect(() => {
    const retryOnGesture = () => {
      if (!needsGestureRetryRef.current || !audioOnRef.current) return;
      const song = currentRef.current;
      if (!song) return;
      needsGestureRetryRef.current = false;
      const audio = ensureAudio();
      // 既に現在の曲が鳴っているなら (stale フラグ) 頭出しし直さない
      if (playingSongIdRef.current === song.id && !audio.paused) return;
      playSnippet(audio, song);
    };
    document.addEventListener("pointerdown", retryOnGesture, true);
    document.addEventListener("click", retryOnGesture, true);
    return () => {
      document.removeEventListener("pointerdown", retryOnGesture, true);
      document.removeEventListener("click", retryOnGesture, true);
    };
     
  }, []);

  // 曲が変わったら試聴音源を差し替える (タップ起点の再生分はスキップ)。
  // デフォルト ON なので初回マウントでもここから再生を試みる
  // (ブロックされたら上のジェスチャ再試行に委ねる)。
  useEffect(() => {
    if (!audioOn) return;
    const audio = ensureAudio();
    if (!current) {
      audio.pause();
      playingSongIdRef.current = null;
      return;
    }
    if (playingSongIdRef.current === current.id) return;
    playSnippet(audio, current);

  }, [audioOn, current]);

  // 楽曲ページ (下スワイプ/リンクで /songs/[id] がホームの上に開いた状態) の
  // 開閉に合わせてフル尺モードを切り替える。開いたら現在の曲を頭から
  // フル尺で再生し直し、閉じたら 6 秒スニペットのデッキ再生に戻る。
  // 回転は active={... && !sheetOpen} で止まるため自動送りも起きない。
  useEffect(() => {
    if (sheetOpen) {
      // 下スワイプ経由はジェスチャ文脈内 (handleOpenSongPage) で再生済み
      if (fullModeRef.current) return;
      fullModeRef.current = true;
      const song = currentRef.current;
      if (audioOnRef.current && song?.itunes_preview_url) {
        playSnippet(ensureAudio(), song);
      }
    } else if (fullModeRef.current) {
      fullModeRef.current = false;
      const song = currentRef.current;
      if (audioOnRef.current && song) {
        playSnippet(ensureAudio(), song);
      }
    }
     
  }, [sheetOpen]);

  /**
   * 下スワイプで現在の曲のページへ連続遷移する。
   * 音源要素は既にアンロック済みなのでフル尺再生をここで開始してから遷移。
   */
  const handleOpenSongPage = () => {
    // 遷移待ちの間の再入を無視する
    if (fullModeRef.current) return;
    const song = currentRef.current;
    if (!song) return;
    triggerHaptic();
    fullModeRef.current = true;
    if (audioOnRef.current && song.itunes_preview_url) {
      playSnippet(ensureAudio(), song);
    }
    router.push(`/songs/${song.id}?via=deck`);
  };
  const handleOpenSongPageRef = useRef(handleOpenSongPage);
  useEffect(() => {
    handleOpenSongPageRef.current = handleOpenSongPage;
  });

  // 下スワイプ = ネイティブスクロール。
  // ホームを縦 2 面のスクロールスナップ ([カバー][デッキ]) にし、初期位置を
  // デッキ面 (最下部) に置く。指を下へ動かすとスクロールが上がり、上の
  // カバー (楽曲ページのプレビュー) が sticky なデッキの上に 1:1 で被さる。
  // ジェスチャ処理をブラウザに任せるため、pointer/touch 実装のような
  // 発火しない系の不具合が構造的に起きない (framer drag → 手動 TouchEvent の
  // 2 方式が実機で発火しなかった経緯からの転換)。
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // 初期位置とシートを閉じた後の復帰: デッキ面 (最下部) へスナップ。
  // useLayoutEffect でペイント前に行い、カバーが一瞬見えるのを防ぐ。
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc || sheetOpen) return;
    sc.scrollTop = sc.scrollHeight - sc.clientHeight;
    dragActiveRef.current = false;
  }, [sheetOpen]);

  const handleCoverScroll = () => {
    const sc = scrollerRef.current;
    if (!sc) return;
    const max = sc.scrollHeight - sc.clientHeight;
    if (max <= 0) return;
    const revealed = max - sc.scrollTop;
    // カバーを引き出している間は回転一周による自動送りを止める
    // (進むと開くページと表示中の曲がズレるため)
    dragActiveRef.current = revealed > COVER_ENGAGE_PX;
    // ほぼ開き切ったら遷移 (スナップで自然に上端まで到達する)
    if (revealed >= max - COVER_ENGAGE_PX) {
      handleOpenSongPageRef.current();
    }
  };

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
  const coverSrc = current.image_url_large ?? current.image_url_medium;

  return (
    // 縦 2 面のスクロールスナップ: [カバー (楽曲ページのプレビュー)][デッキ]。
    // 初期位置はデッキ面。指を下に動かす = ネイティブスクロールでカバーが
    // sticky なデッキの上へ 1:1 で被さり、開き切ると実ページへ遷移する。
    <div
      ref={scrollerRef}
      onScroll={handleCoverScroll}
      className="relative h-dvh snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {/* カバー: 現在の曲のプレビュー面。遷移後は実ページ (z-40) が上に載る */}
      <div className="relative z-20 flex h-dvh snap-start snap-always flex-col items-center justify-center gap-6 bg-background px-8">
        <div className="relative w-full max-w-xs overflow-hidden rounded-xl bg-zinc-800" style={{ aspectRatio: "1 / 1" }}>
          {coverSrc ? (
            <JacketImage
              src={coverSrc}
              alt={`${current.title} のジャケット`}
              fill
              sizes="20rem"
              className="object-cover"
              draggable={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl text-zinc-500">
              ♪
            </div>
          )}
        </div>
        <div className="text-center">
          <h2
            className="line-clamp-2 text-2xl font-bold"
            style={{
              fontFamily:
                '"LatinUpscale", var(--font-geist-sans), system-ui, sans-serif',
            }}
          >
            {current.title}
          </h2>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {current.artist}
          </p>
        </div>
      </div>

      {/* デッキ面のスナップアンカー。sticky なデッキ自身に snap-start を
          付けるとピン留めでスナップ計算が縮退し、mandatory スナップが常に
          カバー面 (scrollTop 0) へ引き戻してしまうため、位置が不変の
          不可視要素でスナップ点だけを定義する */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-[100dvh] h-dvh w-px snap-start snap-always"
      />

      {/* デッキ面: sticky bottom でピン留めし、カバーが上へ被さってくる */}
      <div className="sticky bottom-0 z-10 h-dvh bg-background">
    {/* overflow-clip: transform で外側に置いた隣のディスクが overflow-hidden だと
        スクロール可能領域を作ってしまい、フォーカス移動等の scrollIntoView で
        レイアウト全体が横にずれる。clip はスクロール自体を不可能にする。 */}
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
        // 子の rotateY に奥行きを与える (カバーフロー風の遠近)
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
              style={{
                zIndex: 10 - Math.abs(delta),
                transformStyle: "preserve-3d",
                visibility: Math.abs(delta) > 3 ? "hidden" : "visible",
              }}
            >
              <GroupThumb seed={seed} isActive={isActive} />
            </motion.div>
          );
        })}
      </div>

      {/* 組単位で左へ流れる。中は曲単位のカルーセル + 曲情報。
          消音トグルは組遷移で消えないよう AnimatePresence の外に重ねる */}
      <div className="relative w-full">
        <button
          type="button"
          onClick={handleToggleAudio}
          aria-label={audioOn ? "試聴を停止する" : "試聴を再生する"}
          className="absolute right-1 top-0 z-20 flex size-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition hover:bg-black/60 active:bg-black/70"
        >
          {audioOn ? (
            <Volume2 className="size-5" aria-hidden />
          ) : (
            <VolumeX className="size-5" aria-hidden />
          )}
        </button>
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
          <motion.div
            role="group"
            aria-roledescription="カルーセル"
            aria-label="同じアーティストの楽曲 (下にスワイプで楽曲ページ)"
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
                    scale: isActive ? 1 : 0.65,
                    opacity: Math.abs(delta) > 1 ? 0 : isActive ? 1 : 0.45,
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
                    // 楽曲ページ表示中は回転を止める (= 6 秒送りも停止し、
                    // ページ側のフル尺再生を邪魔しない)
                    active={isActive && !sheetOpen}
                    // ドラッグ中・遷移待ちの間は一周しても曲を進めない
                    // (進むと開くページと音が現在の表示とズレる)
                    onRotationEnd={() => {
                      if (dragActiveRef.current || fullModeRef.current) return;
                      advance(position);
                    }}
                  />
                </motion.div>
              );
            })}
          </motion.div>

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
      </div>

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
      </div>
    </div>
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
function useVinylColor(src: string | null): string | null {
  // 抽出完了時に再レンダーを起こすためのバージョンカウンタ。
  // 色自体は render 時にキャッシュから読む (effect 内の同期 setState を避ける)
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!src || vinylColorCache.has(src)) return;
    let cancelled = false;
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
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return src ? (vinylColorCache.get(src) ?? null) : null;
}

/**
 * 組カルーセルのサムネイル 1 枚分の面 (前面/背面/左右側面)。
 * 親の motion.div (preserve-3d) の直下に fragment で面を並べる。
 * 側面と背面はジャケットの代表色 (レコード盤と同じ抽出) で塗り、
 * 明度を少し落として厚みの陰影に見せる。
 */
function GroupThumb({ seed, isActive }: { seed: Song; isActive: boolean }) {
  const thumbSrc = seed.image_url_medium ?? seed.image_url_large;
  const edgeColor = useVinylColor(thumbSrc) ?? "#3f3f46";
  const edgeStyle = {
    backgroundColor: edgeColor,
    borderRadius: GROUP_THUMB_RADIUS_PX,
    transition: "background-color 0.5s ease",
  } as const;
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
          ...edgeStyle,
          filter: "brightness(0.75)",
          transform: `rotateY(180deg) translateZ(${GROUP_THUMB_DEPTH_PX / 2}px)`,
        }}
      />
      {/* 左右の側面 = 厚み。傾くほど見えてくる背表紙 */}
      <div
        aria-hidden
        className="absolute top-0 h-full"
        style={{
          ...edgeStyle,
          filter: "brightness(0.9)",
          width: GROUP_THUMB_DEPTH_PX,
          left: -GROUP_THUMB_DEPTH_PX / 2,
          transform: "rotateY(90deg)",
        }}
      />
      <div
        aria-hidden
        className="absolute top-0 h-full"
        style={{
          ...edgeStyle,
          filter: "brightness(0.8)",
          width: GROUP_THUMB_DEPTH_PX,
          right: -GROUP_THUMB_DEPTH_PX / 2,
          transform: "rotateY(90deg)",
        }}
      />
    </>
  );
}

interface RecordDiscProps {
  song: Song;
  /** 現在再生位置のディスクのみ回転し、1 周ごとに onRotationEnd を呼ぶ */
  active: boolean;
  onRotationEnd: () => void;
}

/**
 * ジャケット写真を表示時に CSS でレコード盤へ加工する。
 * 中央のラベル (直径 52%) にだけジャケットを置き、外周はジャケットから
 * 抽出した代表色のカラーヴァイナルとして表現する。溝 / ラベル境界 /
 * 光沢 / センターホールをレイヤーで重ねる。回転体は正円なので
 * シルエットが不変であり、overflow-hidden との組み合わせでも輪郭が
 * 乱れない。光沢は光源固定に見せるため回転体の外に置く。
 */
function RecordDisc({ song, active, onRotationEnd }: RecordDiscProps) {
  const src = song.image_url_large ?? song.image_url_medium;
  const vinylColor = useVinylColor(src);
  return (
    <div className="relative h-full w-full">
      {/* 回転体: 代表色の盤面 + 溝 + 中央ラベル (ジャケット) */}
      <div
        className="absolute inset-0 overflow-hidden rounded-full"
        style={{
          animation: active
            ? `record-spin ${ROTATION_MS}ms linear infinite`
            : "none",
        }}
        onAnimationIteration={active ? onRotationEnd : undefined}
      >
        {/* 盤面: ジャケットの代表色 (抽出完了までは無彩色) */}
        <div
          aria-hidden
          className="absolute inset-0"
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
        {/* 中央ラベル: ジャケット写真 */}
        <div
          className="absolute overflow-hidden rounded-full bg-zinc-800"
          style={{ inset: "24%" }}
        >
          {src ? (
            <JacketImage
              src={src}
              alt={`${song.title} のジャケット`}
              fill
              sizes="10.5rem"
              loading="eager"
              className="object-cover"
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

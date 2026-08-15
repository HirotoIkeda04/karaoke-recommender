"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Dices,
  FastForward,
  Minus,
  ScrollText,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";

import { DumbbellMini } from "@/components/icons/dumbbell-mini";
import { useDeckDetail } from "@/components/deck-detail-context";
import { useIsGuest } from "@/components/session-provider";
import { Button, buttonVariants } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { JacketImage } from "@/components/ui/jacket-image";
import { useRatingActions } from "@/hooks/use-rating-actions";
import { readGuestRatings } from "@/lib/guest-ratings";
import { filterUnratedGroups, shuffleGroups } from "@/lib/guest-songs";
import { triggerHaptic } from "@/lib/haptics";
import { formatDuration, midiToKaraoke, noteChipColor } from "@/lib/note";
import { triggerRatingSound } from "@/lib/rating-sound";
import type { Database } from "@/types/database";

import { shuffleDeck } from "./actions";

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
 * 縦に収まらない小さい画面ではヘッダー + 組カルーセル + 曲名 +
 * ボタン群 + ナビの予約分 (約 30rem) を引いた残りへ縮める。上限 20rem。
 * loading.tsx の skeleton と式を揃えること。
 * 内訳: pt-3 0.75 + 組カルーセル 3.5 + gap 1.5 + 曲名 1.75 + gap 1.5 +
 * (盤) + gap 1.5 + 評価 4.875 + gap 1.5 + スキップ行 3.5 + pb-2 0.5 の
 * 20.875rem に、ヘッダーと浮いたナビの実測 9.125rem を足した値。
 */
const DISC_SIZE =
  "min(20rem, calc(100vw - 3.5rem), max(8rem, calc(100svh - 30rem - env(safe-area-inset-bottom))))";

/**
 * 詳細表示 (上スワイプ) 中のディスク径。組カルーセルの行が 3.5rem から
 * 座布団 1 行 (1.5rem) へ縮んで間隔も 0.75rem に詰まり、スキップ行
 * (3.5rem + gap 1.5rem) も消える計 7.75rem の代わりに、楽曲情報 (3 行 =
 * 6.75rem) と歌詞ボタン (mt-2 + 2.25rem) にその上の gap 1.5rem を足した
 * 11rem が入るので、予約は 3.25rem 増える。
 * (詳細ではナビを引っ込めるが、main の下 padding は残るので予約はそのまま)
 */
const DISC_SIZE_DETAIL =
  "min(20rem, calc(100vw - 3.5rem), max(8rem, calc(100svh - 33.25rem - env(safe-area-inset-bottom))))";

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

/** 座布団のフォント。ラテン文字だけ globals.css の縦長 face に載せる */
const PILLOW_FONT = '"CondensedDisplay", var(--font-sans)';

/**
 * 詳細表示を切り替えるスワイプの最小縦移動量 (px)。評価ボタンのタップや
 * 指ブレで誤爆しないだけの距離を取る。横移動が縦移動を上回る間は無視する。
 */
const DETAIL_SWIPE_PX = 48;

/**
 * 詳細表示中の再生尺 (ms)。iTunes の試聴音源 1 本ぶん。この間は 6 秒の
 * フェード / 曲送りを止めてカット無しで流し、流し切ったら盤ごと停止する。
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
  const [shuffling, setShuffling] = useState(false);
  // 上スワイプで入る擬似的な楽曲詳細表示。組カルーセル / スキップ行 /
  // シャッフルを畳み、代わりに楽曲情報と歌詞ボタンを出す (下スワイプで戻る)。
  // この間は 6 秒の自動送りを止め、試聴を 30 秒フルで流す。
  // state をレイアウト側に置いてあるのは、兄弟のボトムナビも引っ込めるため。
  const { detailOpen: detail, setDetailOpen: setDetail } = useDeckDetail();
  // 詳細表示で 30 秒を流し切った曲の id。曲を替えれば自動的に外れるので、
  // 「今の曲が流し終わったか」は下で id を突き合わせて導出する。
  const [detailPlayedOut, setDetailPlayedOut] = useState<string | null>(null);
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // 再生中の曲 id。タップ起点の再生と曲送り effect の二重再生を防ぐ。
  const playingSongIdRef = useRef<string | null>(null);
  // 初期値 true: マウント直後の play() の reject が届く前の素早いタップでも
  // ジェスチャ再試行が動くようにする (鳴っていれば再試行側の guard が弾く)。
  const needsGestureRetryRef = useRef(true);
  // 楽曲ページ (シート) と詳細表示の間のフル尺再生モード
  // (6 秒フェード/カット無効)
  const fullModeRef = useRef(false);

  const group = groups[position.group];
  const current = group?.[position.song];

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
        setAudioBlocked(false);
      },
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
  };

  // 自動再生がブロックされた場合の復帰: 最初の画面操作 (どこでも) の
  // ジェスチャ文脈内で play() し直す。iOS Safari は touchstart 相当
  // (pointerdown) の間はメディア再生を許可しないため、活性化が期待できる
  // pointerup と click の両方で試みる。フラグはここでは下ろさず、再生
  // 成功時に playSnippet 側で下ろす (先に下ろすと、失敗の非同期 reject が
  // click 通過後にフラグを立て直し、何度タップしても鳴らないループになる)。
  // pointerup と click が連続して二重に走った場合は、src の差し替えが
  // 先行の play() を AbortError (無視される正常系) で打ち切るだけで無害。
  useEffect(() => {
    const retryOnGesture = () => {
      if (!needsGestureRetryRef.current || !audioOnRef.current) return;
      const song = currentRef.current;
      if (!song) return;
      const audio = ensureAudio();
      // 既に現在の曲が鳴っているなら (stale フラグ) 頭出しし直さない
      if (playingSongIdRef.current === song.id && !audio.paused) return;
      if (song.itunes_preview_url) {
        playSnippet(audio, song);
      } else {
        // 音源が無い曲でも無音 WAV で要素をアンロックし、以後の曲送りの
        // プログラム再生 (音源のある曲) が通るようにしておく
        playingSongIdRef.current = song.id;
        audio.src = SILENT_WAV;
        void audio.play().then(
          () => {
            needsGestureRetryRef.current = false;
            setAudioBlocked(false);
          },
          () => {},
        );
      }
    };
    document.addEventListener("pointerup", retryOnGesture, true);
    document.addEventListener("click", retryOnGesture, true);
    return () => {
      document.removeEventListener("pointerup", retryOnGesture, true);
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

  // 楽曲シート (リンクで /songs/[id] がホームの上に開いた状態) と詳細表示の
  // 開閉に合わせてフル尺モードを切り替える。入ったら現在の曲を頭からフル尺で
  // 再生し直し、抜けたら 6 秒スニペットのデッキ再生に戻る。
  // シートでは回転が active={... && !sheetOpen} で止まり、詳細表示では
  // onRotationEnd 側が送りを握り潰すので、どちらでも自動送りは起きない。
  const fullPlayback = sheetOpen || detail;
  useEffect(() => {
    if (fullPlayback) {
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

  }, [fullPlayback]);

  // 詳細表示に入ってから 30 秒 (= 試聴音源 1 本ぶん) 経ったら、盤を止めて
  // 音も切る。曲を替えた (評価した) 時は数え直す。抜ければ元の周回に戻る。
  const currentId = current?.id;
  useEffect(() => {
    if (!detail || !currentId) return;
    const timer = window.setTimeout(() => {
      setDetailPlayedOut(currentId);
      audioRef.current?.pause();
    }, DETAIL_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [detail, currentId]);

  // 流し切った判定は「詳細表示中で、かつ今の曲が流し終わっている」時だけ。
  // 曲送りでも詳細を抜けても勝手に外れるので、明示的なリセットは詳細に
  // 入り直す時 (toggleDetail) の 1 箇所だけで足りる。
  const detailEnded = detail && detailPlayedOut === currentId;

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
    const audio = ensureAudio();
    if (audioOn && !audioBlocked) {
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
      void audio.play().then(
        () => {
          needsGestureRetryRef.current = false;
          setAudioBlocked(false);
        },
        () => {},
      );
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

  const toggleDetail = (next: boolean) => {
    if (next === detail) return;
    triggerHaptic();
    setDetail(next);
    // 同じ曲で入り直した時に「もう流し終わっている」扱いにしない
    if (next) setDetailPlayedOut(null);
  };

  /**
   * デッキ全体の縦スワイプで詳細表示を出し入れする。
   * ハンドラは root に置いてあるので、ディスクでもボタンの上でも拾える。
   * 判定を満たした時点で起点を捨て、1 ジェスチャで 1 回だけ切り替える。
   */
  const handleSwipeStart = (event: React.PointerEvent) => {
    swipeRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
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

  // overflow-clip: transform で外側に置いた隣のディスクが overflow-hidden だと
  // スクロール可能領域を作ってしまい、フォーカス移動等の scrollIntoView で
  // レイアウト全体が横にずれる。clip はスクロール自体を不可能にする。
  return (
    <div
      className="relative mx-auto flex max-w-md select-none flex-col items-center gap-6 overflow-clip px-4 pb-2 pt-3"
      // 縦のパンをブラウザに渡さない (渡すと縦スワイプ中に pointercancel が
      // 飛んで判定が落ちる)。横パンとピンチズームはそのまま許可する。
      style={{ touchAction: "pan-x pinch-zoom" }}
      onPointerDown={handleSwipeStart}
      onPointerMove={handleSwipeMove}
      onPointerUp={handleSwipeEnd}
      onPointerCancel={handleSwipeEnd}
      onWheel={(event) => {
        if (Math.abs(event.deltaY) < 8) return;
        toggleDetail(event.deltaY < 0);
      }}
    >
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
        className="absolute left-1 top-1 z-20 flex size-10 items-center justify-center rounded-full text-white transition active:brightness-90 disabled:opacity-60"
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
        className="absolute right-1 top-1 z-20 flex size-10 items-center justify-center rounded-full text-white transition active:brightness-90"
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
              曲名は座布団と同じ縦長 face、曲順とリリース年は楽曲情報と同じ
              等幅 face で軽めに添える。 */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={current.id}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="w-full px-2"
            >
              <h2 className="flex items-baseline justify-center gap-2 text-xl font-semibold">
                <span className="shrink-0 font-mono text-base font-light text-zinc-500 dark:text-zinc-400">
                  #{position.song + 1}
                </span>
                {/* min-w-0: line-clamp の親が flex なので、これが無いと
                    曲名の最小内容幅がデッキごと画面外へ押し広げる */}
                <Link
                  href={`/songs/${current.id}`}
                  className="line-clamp-1 min-w-0 hover:underline"
                  style={{ fontFamily: PILLOW_FONT }}
                >
                  {current.title}
                </Link>
                {current.release_year ? (
                  <span className="shrink-0 font-mono text-sm font-light text-zinc-500 dark:text-zinc-400">
                    (&apos;{String(current.release_year).slice(-2)})
                  </span>
                ) : null}
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
                    // 楽曲ページ表示中は回転を止める (= 6 秒送りも停止し、
                    // ページ側のフル尺再生を邪魔しない)。詳細表示では
                    // 30 秒を流し切った時点で止める。
                    active={isActive && !sheetOpen && !detailEnded}
                    onRotationEnd={() => {
                      // 詳細表示中は 30 秒タイマーが再生を握っているので、
                      // 6 秒ごとの周回では曲を送らない
                      if (detailRef.current) return;
                      advance(position);
                    }}
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
                    <dl className="mx-auto max-w-60 divide-y divide-zinc-200 rounded-xl bg-zinc-100 px-4 text-left text-sm dark:divide-zinc-700/60 dark:bg-zinc-800/60">
                      <div className="flex items-baseline py-2">
                        <dt className="w-14 shrink-0 text-zinc-600 dark:text-zinc-400">
                          地声
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
                      <div className="flex items-baseline py-2">
                        <dt className="w-14 shrink-0 text-zinc-600 dark:text-zinc-400">
                          裏声
                        </dt>
                        <dd className="font-mono">
                          <ColoredNote midi={current.falsetto_max_midi} />
                        </dd>
                      </div>
                      <div className="flex items-baseline py-2">
                        <dt className="w-14 shrink-0 text-zinc-600 dark:text-zinc-400">
                          長さ
                        </dt>
                        <dd className="font-mono">
                          {formatDuration(current.duration_ms) || "—"}
                        </dd>
                      </div>
                    </dl>
                    {/* sort=4 = 歌詞ネットの人気順。検索結果をいきなり
                        人気順で開いて、目当ての曲を探す手間を省く */}
                    <Link
                      href={`https://www.uta-net.com/search/?target=song&type=in&Keyword=${encodeURIComponent(current.title)}&sort=4`}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="歌詞ネットで歌詞を見る"
                      className="mt-2 inline-flex h-9 items-center justify-center gap-2 rounded-full bg-zinc-100/80 px-4 text-xs font-medium text-zinc-700 backdrop-blur-sm transition hover:bg-zinc-200/85 active:bg-zinc-200/85 dark:bg-zinc-800/75 dark:text-zinc-200 dark:hover:bg-zinc-700/80 dark:active:bg-zinc-700/80"
                    >
                      <ScrollText className="size-4" aria-hidden />
                      <span>歌詞を見る</span>
                    </Link>
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
        <button
          type="button"
          onClick={handleSkipSong}
          className="relative flex h-14 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-zinc-700 transition active:brightness-90 dark:text-zinc-100"
        >
          <GlassSurface variant="control" />
          <SkipForward className="relative size-4" aria-hidden />
          <span className="relative">1曲スキップ</span>
        </button>
        <button
          type="button"
          onClick={handleSkipGroup}
          className="relative flex h-14 items-center justify-center gap-1.5 rounded-full text-sm font-medium text-zinc-700 transition active:brightness-90 dark:text-zinc-100"
        >
          <GlassSurface variant="control" />
          <FastForward className="relative size-4" aria-hidden />
          <span className="relative">次の組へ</span>
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={!lastAction}
          className="relative mx-auto flex size-14 items-center justify-center rounded-full text-zinc-700 transition active:brightness-90 disabled:opacity-30 dark:text-zinc-100"
          aria-label="直前の操作を取り消して戻る"
        >
          <GlassSurface variant="control" />
          <Undo2 className="relative size-5" />
        </button>
      </div>
      </motion.div>
    </div>
  );
}

/** 音域ノートを高さ由来の色で表示する。null は無印 "—" (楽曲ページと同じ)。 */
function ColoredNote({ midi }: { midi: number | null | undefined }) {
  if (midi == null) return <>—</>;
  return (
    <span style={{ color: noteChipColor(midi).background }}>
      {midiToKaraoke(midi)}
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
  const spineColor = spineColorOf(useVinylColor(thumbSrc) ?? "#3f3f46");
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
          animation: active
            ? `record-spin ${ROTATION_MS}ms linear infinite`
            : "none",
        }}
        onAnimationIteration={active ? onRotationEnd : undefined}
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
              loading="eager"
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

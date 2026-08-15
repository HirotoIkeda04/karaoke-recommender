/**
 * アプリで 1 つだけ持つ AudioContext。
 *
 * 評価音 (rating-sound) と、デッキの試聴クロスフェード (record-deck) が
 * これを共有する。context を 2 つ作ると、片方だけ resume されて音が出ない
 * 状態が起こり得るため、生成箇所をここに集約している。
 *
 * iOS Safari はユーザー操作の文脈で resume するまで suspended のままで、
 * その間はグラフを通した音が一切鳴らない (要素の play() は成功するのに
 * 無音になる)。そのため生成と resume を別の関数に分けてある。
 */
let ctx: AudioContext | null = null;

function contextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  );
}

/** 生成のみ (resume はしない)。Web Audio が使えない環境では null */
export function getAudioContext(): AudioContext | null {
  const Ctor = contextCtor();
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/** ユーザー操作の文脈で呼ぶ。ここを通さないと iOS では音が出ない */
export function resumeAudioContext(): void {
  const context = getAudioContext();
  if (context && context.state === "suspended") void context.resume();
}

/** グラフを通した音が今実際に鳴らせるか */
export function isAudioContextRunning(): boolean {
  return getAudioContext()?.state === "running";
}

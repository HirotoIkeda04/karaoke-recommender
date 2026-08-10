import type { Database } from "@/types/database";

type Rating = Database["public"]["Enums"]["rating_type"];

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

export function triggerRatingSound(rating: Rating) {
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
    const harp = (
      notes: ReadonlyArray<number>,
      stagger: number,
      peak = 0.085,
    ) => {
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

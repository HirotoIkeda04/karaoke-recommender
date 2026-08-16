/**
 * 評価ボタンの「太いペンで塗った」塗りつぶしを作る。
 *
 * 考え方は 2 段構え:
 *   1. 塗ってよい範囲 (fill area) を、枠よりごく僅かに小さい形として先に決める
 *   2. その範囲を少しはみ出す長さの太い線を上から順に引き、範囲で切る
 *
 * こうすると線と線の間に隙間ができず、塗り残しは枠との間にだけ残る。
 * 範囲は中心を僅かにずらし輪郭も揺らしてあるので、余白の厚みは一周で
 * 変わる (片側は枠に接し、反対側だけ僅かに空く)。
 *
 * 乱数は評価ごとの固定シードなので、同じボタンはいつも同じ塗り跡になる。
 * 4 つぶんをモジュール読み込み時に 1 度だけ組めば、以後の描画は静的。
 */

/** ボタンの SVG 座標系 (56 x 56) と枠の半径 */
const VIEW = 56;
const CENTER = VIEW / 2;
const RING_R = 25.5;

/** ペンの太さ */
const PEN = 12;

/** 塗りの傾き (度)。水平に塗り切った印象を避ける */
const TILT_DEG = -9;

/** 枠から空ける量 (px)。「ごく僅か」= 髪の毛 1 本ぶん */
const GAP_MIN = 0.4;
const GAP_RANGE = 1;

/** 範囲の輪郭の揺らぎ。内側にだけ振る (外へ出ると枠を越える) */
const WOBBLE = 0.7;

/** 段の間隔 = ペン幅のこの倍率。1 未満 = 重なるので段の間に隙間が出ない */
const STEP_RATIO = 0.88;

/** 線を範囲より長く引いておく量 (切られる前提) */
const OVERSHOOT = 3.5;

export interface MarkerFill {
  /** 塗ってよい範囲 (clipPath 用のパス) */
  area: string;
  /** 上から順に引く線。この順で少しずつ遅らせて描く */
  strokes: string[];
  /** 線の太さ */
  penWidth: number;
  /** 塗り全体の傾き (度) */
  tiltDeg: number;
}

/** 決定的な擬似乱数 (mulberry32) */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

/** 文字列から安定したシードを作る (評価の値をそのまま使えるように) */
function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 点列を滑らかな閉じたパスにする (Catmull-Rom → 3 次ベジェ) */
function closedPath(pts: ReadonlyArray<[number, number]>): string {
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % pts.length];
    const p3 = pts[(i + 2) % pts.length];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${f(c1x)} ${f(c1y)} ${f(c2x)} ${f(c2y)} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}

export function buildMarkerFill(key: string): MarkerFill {
  const rand = rng(seedOf(key));
  const gap = GAP_MIN + rand() * GAP_RANGE;
  const rx = RING_R - gap;
  // 縦は横よりごく僅かに小さいだけ (潰すと上下だけ余分に空く)
  const ry = (RING_R - gap) * 0.99;
  const cx = CENTER + (rand() - 0.5) * GAP_RANGE * 0.3;
  const cy = CENTER + (rand() - 0.5) * GAP_RANGE * 0.3;

  // 傾きは範囲の形にも焼き込む。clipPath は要素の transform より前の
  // 座標系で効くので、ここで回しておかないと線とずれる。
  const rad = (TILT_DEG * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts: [number, number][] = [];
  for (let a = 0; a < 360; a += 18) {
    const t = (a * Math.PI) / 180;
    const wob = -rand() * WOBBLE;
    const x = Math.cos(t) * (rx + wob);
    const y = Math.sin(t) * (ry + wob);
    pts.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }

  const strokes: string[] = [];
  const step = PEN * STEP_RATIO;
  const top = cy - ry - PEN * 0.4;
  const bottom = cy + ry + PEN * 0.4;
  for (let y = top; y <= bottom + 0.01; y += step) {
    const t = (y - cy) / ry;
    const half = rx * Math.sqrt(Math.max(0, 1 - Math.min(1, t * t)));
    const left = cx - half - OVERSHOOT;
    const right = cx + half + OVERSHOOT;
    const bow = (rand() - 0.5) * 0.9;
    const y1 = y + (rand() - 0.5) * 0.5;
    const y2 = y + (rand() - 0.5) * 0.5;
    strokes.push(
      `M ${f(left)} ${f(y1)} Q ${f(cx)} ${f(y + bow)} ${f(right)} ${f(y2)}`,
    );
  }

  return {
    area: closedPath(pts),
    strokes,
    penWidth: PEN,
    tiltDeg: TILT_DEG,
  };
}

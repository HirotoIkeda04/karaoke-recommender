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

/** 枠線の太さ。塗りは枠の内側に収める */
const RING_STROKE = 2;

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

export interface MarkerFillShape {
  /** ボタンの実寸 (SVG の viewBox もこの値で書く) */
  width: number;
  height: number;
}

export interface MarkerFill extends MarkerFillShape {
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

/**
 * 角丸長方形の輪郭を等間隔でサンプルする。丸ボタン (w = h) なら円、
 * ピル (w > h) なら両端が半円の形になる。inward は内側への押し込み量。
 */
function roundedRectPoints(
  width: number,
  height: number,
  inset: number,
  inward: (i: number) => number,
  step = 6,
): [number, number][] {
  const r = Math.max(0, height / 2 - inset);
  const left = inset + r;
  const right = width - inset - r;
  const cy = height / 2;
  const pts: [number, number][] = [];
  // 右の半円 → 上辺 (右→左) → 左の半円 → 下辺 (左→右) の順に一周する
  const arc = (cx: number, from: number, to: number) => {
    const steps = Math.max(4, Math.round((Math.abs(to - from) * r) / step));
    for (let i = 0; i <= steps; i++) {
      const a = from + ((to - from) * i) / steps;
      const push = inward(pts.length);
      pts.push([cx + Math.cos(a) * (r - push), cy + Math.sin(a) * (r - push)]);
    }
  };
  const edge = (x1: number, x2: number, y: number, dir: 1 | -1) => {
    const steps = Math.max(1, Math.round(Math.abs(x2 - x1) / step));
    for (let i = 1; i < steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      pts.push([x, y + dir * inward(pts.length)]);
    }
  };
  arc(right, -Math.PI / 2, Math.PI / 2);
  edge(right, left, height - inset, -1);
  arc(left, Math.PI / 2, (Math.PI * 3) / 2);
  edge(left, right, inset, 1);
  return pts;
}

/**
 * key ごとに決まった塗りを組む。丸ボタンは width = height = 56 が既定。
 * スキップのようなピル型は実寸を渡す (幅は端末によって変わるので、
 * 呼び出し側が測ってから渡す)。
 */
export function buildMarkerFill(
  key: string,
  shape: MarkerFillShape = { width: 56, height: 56 },
): MarkerFill {
  const { width, height } = shape;
  const rand = rng(seedOf(key));
  const gap = RING_STROKE / 2 + GAP_MIN + rand() * GAP_RANGE;
  const jitters = Array.from({ length: 256 }, () => rand() * WOBBLE);

  const area = closedPath(
    roundedRectPoints(width, height, gap, (i) => jitters[i % jitters.length]),
  );

  // 線は水平に引いてから全体を傾けるので、長い線ほど端が上下へ逃げる。
  // 逃げる量 (drift) のぶん上下に段を足しておかないと、幅の広いピルでは
  // 左上と右下が三角に塗り残る。左右も同じ理由で伸ばしておく。
  const rad = (TILT_DEG * Math.PI) / 180;
  const drift = Math.abs(Math.tan(rad)) * (width / 2);
  const lean = Math.abs(Math.tan(rad)) * height;
  const top = gap - drift;
  const bottom = height - gap + drift;
  const strokes: string[] = [];
  const step = PEN * STEP_RATIO;
  for (let y = top; y <= bottom + step; y += step) {
    const yy = Math.min(y, bottom);
    const left = -OVERSHOOT - lean;
    const right = width + OVERSHOOT + lean;
    const bow = (rand() - 0.5) * 0.9;
    const y1 = yy + (rand() - 0.5) * 0.5;
    const y2 = yy + (rand() - 0.5) * 0.5;
    strokes.push(
      `M ${f(left)} ${f(y1)} Q ${f(width / 2)} ${f(yy + bow)} ${f(right)} ${f(y2)}`,
    );
    if (yy >= bottom) break;
  }

  return { area, strokes, penWidth: PEN, tiltDeg: TILT_DEG, width, height };
}

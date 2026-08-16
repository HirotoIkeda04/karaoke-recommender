/**
 * 文字の上にマーカー (蛍光ペン) を引いた跡を作る。
 *
 * 丸い筆先で引くと角丸チップにしか見えないので、両端を斜めに切り落とした
 * 帯として描く (平芯マーカーの筆跡)。帯の高さは文字より低く、少し下寄りに
 * 置くので、上下から字がはみ出す = 引いた後の見え方になる。
 *
 * 2 度引きで、上下にずらした 2 本の和が文字全体を覆う。2 本目は乗算で
 * 重ねる: 同じ色をそのまま重ねても色は変わらず、1 本と区別が付かないため。
 *
 * 乱数は文字列 (音名) の固定シードなので、同じ音名はいつも同じ引き方になる。
 * 幅は呼び出し側が実測して渡す (伸縮させると筆先の角度が歪む)。
 */

/** 帯の高さ = 文字の高さのこの割合 */
const BAND_RATIO = 0.74;
/** 2 度引きの 1 本あたりの高さ = 帯のこの割合 */
const PASS_RATIO = 0.78;
/** 帯の中心を文字の中心からどれだけ下げるか (文字の高さ比) */
const DROP_RATIO = 0.06;
/** 文字の左右へはみ出す量 (px) の範囲 */
const OVER_MIN = 1;
const OVER_MAX = 2.5;
/** 平芯の傾き (px)。左右で別々に振る */
const SKEW_MIN = 2;
const SKEW_MAX = 5;
/** 上下の縁の反り (px) */
const BOW = 1.4;
/** 全体の傾き (度) */
export const HIGHLIGHT_TILT_DEG = -2;
/** 塗りの不透明度 */
export const HIGHLIGHT_OPACITY = 0.9;

export interface Highlight {
  /** SVG の実寸 (文字の周囲に余白を足したもの) */
  width: number;
  height: number;
  /** 文字ボックスに対する SVG のオフセット (負値) */
  offset: number;
  /** 下に敷く帯 → 上に乗算で重ねる帯 の順 */
  paths: string[];
}

function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let s = h >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => n.toFixed(1);

export function buildHighlight(
  seed: string,
  width: number,
  height: number,
): Highlight {
  const rand = rng(seed);
  const pad = height;
  const band = height * BAND_RATIO;
  const center = pad + height / 2 + height * DROP_RATIO;
  const each = band * PASS_RATIO;

  const swipe = (yCenter: number, thickness: number): string => {
    const x1 = pad - (OVER_MIN + rand() * (OVER_MAX - OVER_MIN));
    const x2 = pad + width + (OVER_MIN + rand() * (OVER_MAX - OVER_MIN));
    const half = thickness / 2;
    // 引き始めと引き終わりで角度を変える (平芯を寝かせた向きの差)
    const skewL = SKEW_MIN + rand() * (SKEW_MAX - SKEW_MIN);
    const skewR = SKEW_MIN + rand() * (SKEW_MAX - SKEW_MIN);
    const bowTop = (rand() - 0.5) * BOW;
    const bowBottom = (rand() - 0.5) * BOW;
    const yT = yCenter - half;
    const yB = yCenter + half;
    return (
      `M ${f(x1)} ${f(yT)}` +
      ` Q ${f(pad + width / 2)} ${f(yT + bowTop)} ${f(x2)} ${f(yT)}` +
      ` L ${f(x2 + skewR)} ${f(yB)}` +
      ` Q ${f(pad + width / 2)} ${f(yB + bowBottom)} ${f(x1 + skewL)} ${f(yB)} Z`
    );
  };

  return {
    width: width + pad * 2,
    height: height + pad * 2,
    offset: -pad,
    paths: [swipe(center + each * 0.3, each), swipe(center - each * 0.32, each)],
  };
}

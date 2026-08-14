"use client";

import { Glass, type GlassOptics } from "@samasante/liquid-glass";

/**
 * Liquid Glass のサーフェス層。
 *
 * 使い方は「既存の要素の中に敷く」形に統一している:
 *
 *   <button className="relative rounded-full …">   ← 既存のボタンはそのまま
 *     <GlassSurface variant="control" radius={9999} />
 *     <Icon className="relative" />
 *   </button>
 *
 * こうすると既存要素の class / ハンドラ / a11y / レイアウトに一切触らずに
 * 背景だけをガラスへ差し替えられる。<Glass> 自体を外側に被せると grid の
 * 子や framer-motion の対象が入れ替わってしまうため採用しない。
 *
 * 敷く側の前提は 3 つ:
 *   1. position が static でない (relative / fixed / absolute)
 *   2. 自前の不透明な背景色を持たない
 *   3. 中身に relative を付ける
 * 3 が要るのは CSS の描画順のため。絶対配置のこの層は「配置済み要素」として
 * 通常フローの中身より後に描かれるので、relative を付けずに置くとアイコンや
 * ラベルがガラスのヴェールの下に潜る。中身も配置済みにすれば、あとは DOM 順
 * (このコンポーネントを先に置く) で前後が決まる。
 *
 * ブラウザ差:
 *   Chromium … backdrop-filter: url() が使えるので背後の live DOM が実際に歪む。
 *   iOS Safari / Firefox … url() 非対応なので blur + saturate へ自動縮退し、
 *     ヴェール・内側スペキュラ・縁のハイライトだけが残る。PWA の主ターゲットは
 *     こちらなので、各 variant はまず「屈折なしでもガラスに見えるか」で調整している。
 */
type GlassVariant = "bar" | "control" | "overlay";

/**
 * ダーク UI (背景 #121212) 前提のチューニング。
 * ライブラリの `brightness` は「乗せるヴェールの不透明度」(正で白 / 負で黒) で、
 * 背景色に依らず一定量を足し引きする。これだけだと二律背反になる:
 *   黒ヴェール … 明るい背景でも白アイコンが読めるが、暗い背景ではただの黒帯。
 *   白ヴェール … 暗い背景で「浮いたガラス」に見えるが、白い背景では溶けて消える。
 * ボトムナビは常時表示で背後が何でも起こり得るので、下に敷いた dim 層の
 * `backdrop-filter: brightness()` (乗算) で先に背景を沈めてから白ヴェールを
 * 乗せる。乗算は明るい背景ほど強く効くので、
 *   #121212 → やや明るい (= 背景から浮く)  /  白 → 中間グレー (= アイコンが読める)
 * の両立になる。これは iOS のダーク系マテリアルの振る舞いに近い。
 */
const OPTICS: Record<GlassVariant, Partial<GlassOptics>> = {
  // ボトムナビのような横長で面積の大きいバー。
  // 屈折を強くすると縁で背景が伸びて安っぽくなるので、ブラーと彩度を主役にする。
  bar: {
    frost: 20,
    saturate: 1.9,
    brightness: 0.1,
    specular: 1.1,
    sheen: 0.4,
    sheenWidth: 14,
    glow: 0.1,
    depth: 0.4,
    curvature: 0.2,
    bend: 0.3,
    dispersion: 0.28,
    strength: 0.045,
  },
  // 円形 / ピル型のフローティングボタン。小さいぶん厚み感を強めに出す。
  // 背後が常にアプリ背景 (暗い) である前提で、白ヴェールで浮かせる。
  control: {
    frost: 12,
    saturate: 1.7,
    brightness: 0.08,
    specular: 1.05,
    sheen: 0.36,
    sheenWidth: 8,
    glow: 0.14,
    depth: 0.7,
    curvature: 0.5,
    bend: 0.5,
    dispersion: 0.4,
    strength: 0.08,
  },
  // ジャケット画像の上に重なるフローティングボタン用。
  // control と同じ形状だが、明るい画像の上で白アイコンが飛ばないよう
  // ヴェールを黒側へ反転させている。
  overlay: {
    frost: 12,
    saturate: 1.7,
    brightness: -0.2,
    specular: 1.05,
    sheen: 0.36,
    sheenWidth: 8,
    glow: 0.14,
    depth: 0.7,
    curvature: 0.5,
    bend: 0.5,
    dispersion: 0.4,
    strength: 0.08,
  },
};

/**
 * ガラスの下に敷く乗算の減光層 (variant ごと、null なら敷かない)。
 * 値は backdrop-filter: brightness() に渡る係数。
 */
const DIM: Record<GlassVariant, number | null> = {
  bar: 0.12,
  control: null,
  overlay: null,
};

interface GlassSurfaceProps {
  variant?: GlassVariant;
  /** 角丸 (px)。ピル / 正円は 9999 を渡す。 */
  radius?: number;
  className?: string;
}

export function GlassSurface({
  variant = "control",
  radius = 9999,
  className,
}: GlassSurfaceProps) {
  const dim = DIM[variant];
  return (
    <>
      {dim != null ? (
        // ガラスより先に置くことで背面に入り、ガラスの backdrop-filter は
        // この層が減光した結果をサンプリングする (backdrop-filter は描画順に
        // 合成されるので重ねられる)。
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: radius,
            pointerEvents: "none",
            backdropFilter: `brightness(${dim})`,
            WebkitBackdropFilter: `brightness(${dim})`,
          }}
        />
      ) : null}
      <Glass
        aria-hidden
        className={className}
        radius={radius}
        optics={OPTICS[variant]}
        style={{
          // <Glass> の既定は display:inline-block なので、必ず style 側で上書きする
          // (インラインスタイルなので className では勝てない)。
          display: "block",
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          pointerEvents: "none",
        }}
      >
        {/* <Glass> は children が null だと material (backdrop-filter) モードに
            入らず、背後を複製して屈折させるコピーモードへ落ちる。コピーモードの
            ラッパーは width:fit-content なので、中身が無いこの使い方だと幅 0 に
            潰れてガラスが一切描かれない。ダミーの子を 1 つ置いて material を
            選ばせる (display:none なのでレイアウトにも描画にも影響しない)。 */}
        <span aria-hidden style={{ display: "none" }} />
      </Glass>
    </>
  );
}

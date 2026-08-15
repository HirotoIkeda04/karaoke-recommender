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
/**
 * 質感の目標は Luma (lu.ma) の iOS アプリ。実機スクリーンショットから読み取った
 * 特徴は 4 つで、これがそのままチューニングの制約になっている:
 *
 *   1. 縁の鏡面ハイライトがほぼ無い。ガラスの稜線を主張せず、マットに近い。
 *   2. 色がニュートラル。背後のカラフルな画像の色をほとんど拾わない。
 *   3. 色収差 (縁の色ズレ) が無い。
 *   4. 素材色は iOS のシステムグレー。
 *        バー          #1c1c1e (systemGray6)
 *        アクティブ    #3a3a3c (systemGray4)  ← goo の fill と一致させてある
 *
 * したがって specular / sheen / glow / dispersion はいずれも「効かせない」方向へ
 * 振る。これらを上げると途端に「安いガラス風エフェクト」に見えるのが、
 * Luma と並べた時に一番効く差だった。透け感はブラーと減光層だけで作る。
 */
const OPTICS: Record<GlassVariant, Partial<GlassOptics>> = {
  // ボトムナビのような横長で面積の大きいバー。
  bar: {
    frost: 24,
    // 1.0 に近づけて背後の色を拾わせない (Luma はニュートラルなグレー)
    saturate: 1.15,
    // 黒地の上で #1f1f1f 前後 = systemGray6 近辺に着地する量
    brightness: 0.12,
    specular: 0.28,
    sheen: 0.1,
    // 幅を広げるほど稜線がぼやけて「線」に見えなくなる
    sheenWidth: 22,
    glow: 0.03,
    depth: 0.3,
    curvature: 0.12,
    bend: 0.18,
    dispersion: 0.08,
    strength: 0.03,
  },
  // 円形 / ピル型のフローティングボタン。
  // 背後が常にアプリ背景 (暗い) である前提で、白ヴェールで浮かせる。
  control: {
    frost: 16,
    saturate: 1.15,
    brightness: 0.1,
    specular: 0.3,
    sheen: 0.12,
    sheenWidth: 14,
    glow: 0.04,
    depth: 0.35,
    curvature: 0.2,
    bend: 0.22,
    dispersion: 0.08,
    strength: 0.035,
  },
  // ジャケット画像の上に重なるフローティングボタン用。
  // control と同じ質感だが、明るい画像の上で白アイコンが飛ばないよう
  // ヴェールを黒側へ反転させている。
  overlay: {
    frost: 16,
    saturate: 1.15,
    brightness: -0.18,
    specular: 0.3,
    sheen: 0.12,
    sheenWidth: 14,
    glow: 0.04,
    depth: 0.35,
    curvature: 0.2,
    bend: 0.22,
    dispersion: 0.08,
    strength: 0.035,
  },
};

/**
 * ガラスの下に敷く乗算の減光層 (variant ごと、null なら敷かない)。
 * 値は backdrop-filter: brightness() に渡る係数。
 */
const DIM: Record<GlassVariant, number | null> = {
  // Luma のバーは「背後の文字が滲んで見える」程度でかなり不透明寄り。
  // 透け過ぎるとガラスというより素通しに見えるので、0.3 から一段沈めた。
  bar: 0.2,
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

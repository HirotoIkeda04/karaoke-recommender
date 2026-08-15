/**
 * 画面下部に浮かぶバーの寸法と色。
 *
 * app-bottom-nav / app-search-bar / liquid-glass/nav-lab の 3 箇所が
 * 同じ寸法で並ぶ必要があるため、定義はここ 1 つに集約する。以前は
 * それぞれが自前の定数を持っていて、片方だけ直して食い違う事故が起きた。
 */

/**
 * バーの実高。
 *
 * 純正 iOS 26 のタブバー実測値に合わせてある (iPhone 17 Pro / iOS 26.5 の
 * ヘルスケアアプリを 3x スクショから採寸):
 *   カプセル上端 792pt / 下端 850pt → 高さ 約 57pt
 * 以前は 4rem (64px) で、7pt ぶん背が高く「純正より大きい」と読めていた。
 *
 * 画面下端との間隔と合わせて (app)/layout.tsx の main の bottom padding、
 * および record-deck / (app)/loading の DISC_SIZE の縦予算に効く。
 * ここを変えたら必ずその 3 箇所を確認すること (今回は縮む方向なので
 * どちらもクリアランスが増えるだけ)。
 */
export const BAR_HEIGHT_REM = 3.5;
export const BAR_HEIGHT_PX = BAR_HEIGHT_REM * 16;

/**
 * バーの左右インセット。純正は左右とも約 20pt (カプセル左端 21pt /
 * 検索円の右端から 19pt)。Tailwind の px-5 と一致する。
 */
export const BAR_INSET_CLASS = "px-5";

/**
 * くっついている要素と離れている要素の間隔。
 * 「離れている」ことの表現そのものなので、詰めすぎると構造が読めなくなる。
 */
export const SPLIT_GAP_PX = 8;

/** タブのラベル行の高さ。アイコン 24 + 隙間 3 + これ = 39px でバーに収まる。 */
export const LABEL_PX = 12;

/**
 * 選択インジケータ (液体の塊) の寸法。アイコンとラベルをまとめて包む。
 *
 * 角丸はバーと同心になるように決める。バーは rounded-full なので角丸は
 * 高さの半分 = 28px。インジケータは上下 (56-48)/2 = 4px 内側に入るので、
 * 同心の角丸は 28 - 4 = 24px。ここを小さくすると、カプセルの中で
 * インジケータだけ角張って見える (18px だった頃がまさにそれ)。
 *
 * 上下の逃げ 4px は純正とも一致する (ヘルスケアの選択中タブは高さ 58pt の
 * カプセルに対し 50pt ほどで、上下 4pt ずつ内側)。
 *
 * 左右の逃げは、両端のタブでインジケータがバーの丸い先端とぶつからない
 * ようにするため。
 */
export const PILL_H = 48;
export const PILL_R = 24;
export const PILL_INSET_X = 6;

/** インジケータの移動時間。goo のバネはこれを追いかけて尾を引く。 */
export const MOVE_TRANSITION = "transform .52s cubic-bezier(.34,1.36,.42,1)";

/**
 * goo の塗り。必ず不透明色にすること。
 * goo フィルタは alpha' = contrast*a - offset (既定 20a - 7.83) でアルファを
 * 切り直すため、半透明色を渡すと alpha' が負に振り切れてシルエットが丸ごと
 * 消える。透け感は色そのもので作る。
 * #3f3f42 は iOS の systemGray4 (#3a3a3c) を一段明るくした値。
 */
export const GOO_FILL = "#3f3f42";

/**
 * liquid-gooey の move ノブ。スリム側の名前は
 * springiness / wobble / stretch / trail。
 * stiffness / damping / tail は raw (advanced) 側の名前なので、
 * ここに直接書くと型が弾く (通っても黙って既定値になる)。
 */
export const MOVE_KNOBS = {
  springiness: 0.5,
  wobble: 0.6,
  stretch: 0.5,
  trail: 0.7,
};

/** バーの落ち影。カプセルと円ボタンで共通。 */
export const BAR_SHADOW = "0 10px 30px -8px rgba(0,0,0,0.7)";

/**
 * バーそのものを goo で描くときの塗り。
 *
 * GOO_FILL (選択インジケータ) と違い、こちらは「ガラスの下に隠れているべき
 * シルエット」の色。バーがアプリ背景 (#121212) の上で見えている色に
 * 合わせてある。合っていないとガラス越しに下地が透けて、バーの中に
 * 一段違う色の板が入って見える。
 *
 * 見えている色の内訳: 背景 18 → DIM.bar の brightness(0.2) で 3.6 →
 * <Glass> の brightness 0.12 の白ヴェールで 3.6*0.88 + 255*0.12 ≒ 34。
 */
export const BAR_FILL = "#222224";

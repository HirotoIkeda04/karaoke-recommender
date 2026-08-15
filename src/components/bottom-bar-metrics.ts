/**
 * 画面下部に浮かぶバーの寸法と色。
 *
 * app-bottom-nav / app-search-bar / liquid-glass/nav-lab の 3 箇所が
 * 同じ寸法で並ぶ必要があるため、定義はここ 1 つに集約する。以前は
 * それぞれが自前の定数を持っていて、片方だけ直して食い違う事故が起きた。
 */

/**
 * バーの実高。画面下端との間隔と合わせて (app)/layout.tsx の main の
 * bottom padding、および record-deck / (app)/loading の DISC_SIZE の
 * 縦予算に効く。ここを変えたら必ずその 3 箇所を確認すること。
 */
export const BAR_HEIGHT_REM = 4;
export const BAR_HEIGHT_PX = BAR_HEIGHT_REM * 16;

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
 * 高さの半分 = 32px。インジケータは上下 (64-48)/2 = 8px 内側に入るので、
 * 同心の角丸は 32 - 8 = 24px。ここを小さくすると、カプセルの中で
 * インジケータだけ角張って見える (18px だった頃がまさにそれ)。
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

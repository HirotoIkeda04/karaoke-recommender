"use client";

import dynamic from "next/dynamic";
import { Check, Dumbbell, Home, LibraryBig, Search, Users, X } from "lucide-react";

import styles from "./liquid-glass.module.css";

// rdev 版は feDisplacementMap (SVG filter) を使うため SSR を無効化して
// クライアントのみで描画する。これにより SSR 時の window 参照も回避。
const LiquidGlass = dynamic(() => import("liquid-glass-react"), {
  ssr: false,
});

const SONGS = [
  { t: "Lemon", a: "米津玄師", j: styles.j1 },
  { t: "夜に駆ける", a: "YOASOBI", j: styles.j2 },
  { t: "Pretender", a: "Official髭男dism", j: styles.j3 },
  { t: "白日", a: "King Gnu", j: styles.j4 },
  { t: "マリーゴールド", a: "あいみょん", j: styles.j5 },
  { t: "群青", a: "YOASOBI", j: styles.j6 },
  { t: "ドライフラワー", a: "優里", j: styles.j2 },
  { t: "怪物", a: "YOASOBI", j: styles.j1 },
  { t: "シルエット", a: "KANA-BOON", j: styles.j3 },
  { t: "オトナブルー", a: "新しい学校のリーダーズ", j: styles.j5 },
] as const;

const NAV = [
  { label: "評価", Icon: Home, active: true },
  { label: "検索", Icon: Search, active: false },
  { label: "ライブラリ", Icon: LibraryBig, active: false },
  { label: "ルーム", Icon: Users, active: false },
] as const;

function Backdrop() {
  return (
    <div className={styles.backdrop}>
      {[...SONGS, ...SONGS].map((s, i) => (
        <div className={styles.songRow} key={i}>
          <div className={`${styles.jacket} ${s.j}`} />
          <div className={styles.songMeta}>
            <div className={styles.songTitle}>{s.t}</div>
            <div className={styles.songArtist}>{s.a} · ~ hiF</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ===== A. 自前 CSS Liquid Glass ===== */
function CssGlassMock() {
  return (
    <div className={styles.frame}>
      <div className={styles.scrollArea}>
        <Backdrop />
      </div>

      <header className={`${styles.glass} ${styles.glassHeader}`}>
        <span className={styles.brand}>KyokuMoku</span>
        <span className={styles.headerBtn}>ホームに追加</span>
      </header>

      <div className={`${styles.glass} ${styles.dock}`}>
        <div className={styles.dockBtn} style={{ color: "#f87171" }}>
          <X size={18} />
        </div>
        <div className={styles.dockBtn} style={{ color: "#a78bfa" }}>
          <Dumbbell size={16} />
        </div>
        <div className={styles.dockBtn} style={{ color: "#34d399" }}>
          <Check size={18} />
        </div>
      </div>

      <nav className={`${styles.glass} ${styles.glassNav}`}>
        {NAV.map(({ label, Icon, active }) => (
          <div
            key={label}
            className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
          >
            <Icon size={20} />
            <span>{label}</span>
          </div>
        ))}
      </nav>
    </div>
  );
}

/* ===== B. liquid-glass-react (rdev) ===== */
function RdevGlassMock() {
  return (
    <div className={styles.frame}>
      <div className={styles.scrollArea}>
        <Backdrop />
      </div>

      <div className={styles.rdevSlotTop}>
        <LiquidGlass
          cornerRadius={20}
          blurAmount={0.08}
          saturation={170}
          displacementScale={38}
          aberrationIntensity={2}
          elasticity={0}
          padding="0.7rem 1.1rem"
          mode="standard"
        >
          <div className={styles.rdevHeaderInner}>
            <span className={styles.brand}>KyokuMoku</span>
            <span className={styles.headerBtn}>ホームに追加</span>
          </div>
        </LiquidGlass>
      </div>

      <div className={styles.rdevSlotBottom}>
        <LiquidGlass
          cornerRadius={22}
          blurAmount={0.08}
          saturation={170}
          displacementScale={52}
          aberrationIntensity={2}
          elasticity={0}
          padding="0.55rem 0.9rem"
          mode="standard"
        >
          <div className={styles.rdevNavInner}>
            {NAV.map(({ label, Icon, active }) => (
              <div
                key={label}
                className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}
              >
                <Icon size={20} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}

export default function LiquidGlassPreviewPage() {
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div className={styles.headingTitle}>Liquid Glass 移行プレビュー</div>
        <p className={styles.headingSub}>
          同じ KyokuMoku 画面 (ヘッダー / 評価ドック / ボトムナビ) を 2 方式で実装。
          背景はガラスのブラー・彩度・屈折を見せるため意図的にカラフルにしています。
          スクロールすると背景がガラス越しに動きます。
          <br />
          <b>実機 (iOS Safari / PWA) で必ず両方を見比べてください。</b>
          rdev 版は実機では屈折が出ません。
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <div className={styles.colLabel}>
            <span className={styles.colLabelName}>
              A. 自前 CSS Liquid Glass
            </span>
            <span className={`${styles.colLabelBadge} ${styles.badgeOk}`}>
              iOS Safari ◎ そのまま出荷可
            </span>
          </div>
          <CssGlassMock />
        </div>

        <div className={styles.col}>
          <div className={styles.colLabel}>
            <span className={styles.colLabelName}>
              B. liquid-glass-react (rdev)
            </span>
            <span className={`${styles.colLabelBadge} ${styles.badgeWarn}`}>
              Chrome ◎ / iOS Safari △ 屈折なし
            </span>
          </div>
          <RdevGlassMock />
        </div>
      </div>

      <div className={styles.note}>
        <b>判断材料:</b> A は <code>backdrop-filter: blur + saturate</code> に
        鏡面ハイライト・極薄ボーダー・内側シャドウを重ねた自前実装。依存ゼロ・
        iOS Safari で安定動作し、本アプリ (PWA) でそのまま採用できます。
        B は <code>feDisplacementMap</code> による本物の屈折・色収差で、
        デスクトップ Chrome では最も Apple に近い見た目ですが、
        <b> Safari / Firefox では屈折が描画されず単なる blur に劣化</b>します
        (公式 README に明記)。さらに B は <b>ガラス内のプレーンテキストが
        displacement で歪み・視認性が落ちる</b> (上のヘッダーで「KyokuMoku」が
        溶ける / ナビ文字が滲む) ため、文字主体の UI バーには不向きです。
        本アプリの主ターゲットが iOS Safari PWA である以上、
        実採用は A、B は質感の上限を知るための参考、という位置づけが現実的です。
      </div>
    </div>
  );
}

"use client";

import { Check, Dumbbell, Home, LibraryBig, Search, Users, X } from "lucide-react";

import styles from "./liquid-glass.module.css";

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

function GlassMock() {
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

export default function LiquidGlassPreviewPage() {
  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div className={styles.headingTitle}>Liquid Glass リファレンス</div>
        <p className={styles.headingSub}>
          KyokuMoku の各サーフェス (ヘッダー / 評価ドック / ボトムナビ) を
          自前 CSS Liquid Glass で実装した参照モック。背景はガラスのブラー・彩度を
          見せるため意図的にカラフルにしています。スクロールすると背景が
          ガラス越しに動きます。
          <br />
          <b>本アプリへ段階移行する際の見本</b>として残しています。
        </p>
      </div>

      <div className={styles.grid}>
        <div className={styles.col}>
          <div className={styles.colLabel}>
            <span className={styles.colLabelName}>自前 CSS Liquid Glass</span>
            <span className={`${styles.colLabelBadge} ${styles.badgeOk}`}>
              iOS Safari ◎ 依存ゼロ
            </span>
          </div>
          <GlassMock />
        </div>
      </div>

      <div className={styles.note}>
        <b>実装:</b> <code>backdrop-filter: blur + saturate</code> に
        鏡面ハイライト・極薄ボーダー・内側シャドウを重ねた自前 CSS。
        依存ゼロ・iOS Safari で安定動作し、コンポーネント単位で
        既存 UI に段階適用できます。採用が固まったらこのスタイルを
        <code>globals.css</code> / 共通コンポーネントへ昇格させ、
        サーフェス単位で順次差し替えていく想定です。
      </div>
    </div>
  );
}

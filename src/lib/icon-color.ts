// ユーザーアイコンの背景。ソリッド色 (#rrggbb) と
// グラデーションプリセット (gradient:<id>) の 2 系統を扱う。
// DB の profiles.icon_color は text なのでどちらも同じカラムに保存する。
import type { CSSProperties } from "react";

// ---- Solid colors ----------------------------------------------------------

export const ICON_COLOR_PALETTE = [
  "#ec4899", // pink
  "#f43f5e", // rose
  "#ef4444", // red
  "#f97316", // orange
  "#f59e0b", // amber
  "#eab308", // yellow
  "#84cc16", // lime
  "#22c55e", // green
  "#10b981", // emerald
  "#14b8a6", // teal
  "#06b6d4", // cyan
  "#0ea5e9", // sky
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#8b5cf6", // violet
  "#a855f7", // purple
  "#d946ef", // fuchsia
  "#71717a", // zinc
] as const;

export type IconSolid = (typeof ICON_COLOR_PALETTE)[number];

export const DEFAULT_ICON_COLOR: IconSolid = "#ec4899";

const PALETTE_SET: ReadonlySet<string> = new Set(ICON_COLOR_PALETTE);

// ---- Gradient presets ------------------------------------------------------
// 複数の radial-gradient を重ねるだけでオーラ/blur 風の見た目になる。
// filter:blur(...) を使うと中の文字までボケるので background-image だけで構成する。

export interface IconGradient {
  id: string; // 保存用 ID。実際のカラム値は `gradient:${id}` 形式
  name: string; // ピッカー用ラベル
  css: string; // backgroundImage に直接渡す値
}

const GRADIENT_PREFIX = "gradient:";

export const ICON_GRADIENT_PALETTE: readonly IconGradient[] = [
  {
    id: "aurora",
    name: "オーロラ",
    css: [
      "radial-gradient(circle at 22% 18%, #1f3a2f 0%, transparent 55%)",
      "radial-gradient(circle at 82% 22%, #f97316 0%, transparent 55%)",
      "radial-gradient(circle at 78% 82%, #475569 0%, transparent 60%)",
      "radial-gradient(circle at 18% 80%, #14b8a6 0%, transparent 55%)",
      "linear-gradient(135deg, #2d4a3e, #1a2230)",
    ].join(", "),
  },
  {
    id: "sunset",
    name: "サンセット",
    css: [
      "radial-gradient(circle at 25% 25%, #fbbf24 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #f43f5e 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #8b5cf6 0%, transparent 55%)",
      "radial-gradient(circle at 20% 82%, #ec4899 0%, transparent 55%)",
      "linear-gradient(135deg, #f97316, #7c3aed)",
    ].join(", "),
  },
  {
    id: "ocean",
    name: "オーシャン",
    css: [
      "radial-gradient(circle at 25% 22%, #06b6d4 0%, transparent 55%)",
      "radial-gradient(circle at 80% 28%, #3b82f6 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #1e3a8a 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #22d3ee 0%, transparent 55%)",
      "linear-gradient(135deg, #0ea5e9, #1e3a8a)",
    ].join(", "),
  },
  {
    id: "forest",
    name: "フォレスト",
    css: [
      "radial-gradient(circle at 25% 22%, #10b981 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #65a30d 0%, transparent 55%)",
      "radial-gradient(circle at 78% 78%, #14532d 0%, transparent 60%)",
      "radial-gradient(circle at 20% 80%, #5eead4 0%, transparent 55%)",
      "linear-gradient(135deg, #047857, #134e4a)",
    ].join(", "),
  },
  {
    id: "lavender",
    name: "ラベンダー",
    css: [
      "radial-gradient(circle at 25% 22%, #c4b5fd 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #f0abfc 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #818cf8 0%, transparent 55%)",
      "radial-gradient(circle at 22% 82%, #f9a8d4 0%, transparent 55%)",
      "linear-gradient(135deg, #a78bfa, #ec4899)",
    ].join(", "),
  },
  {
    id: "ember",
    name: "エンバー",
    css: [
      "radial-gradient(circle at 25% 25%, #fde047 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #f97316 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #b91c1c 0%, transparent 60%)",
      "radial-gradient(circle at 20% 82%, #fb923c 0%, transparent 55%)",
      "linear-gradient(135deg, #ea580c, #7f1d1d)",
    ].join(", "),
  },
  {
    id: "midnight",
    name: "ミッドナイト",
    css: [
      "radial-gradient(circle at 25% 22%, #1e293b 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #312e81 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #0f172a 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #6366f1 0%, transparent 55%)",
      "linear-gradient(135deg, #1e1b4b, #020617)",
    ].join(", "),
  },
  {
    id: "candy",
    name: "キャンディ",
    css: [
      "radial-gradient(circle at 25% 22%, #ec4899 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #0ea5e9 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #a855f7 0%, transparent 55%)",
      "radial-gradient(circle at 22% 82%, #fb923c 0%, transparent 55%)",
      "linear-gradient(135deg, #db2777, #1d4ed8)",
    ].join(", "),
  },
  {
    id: "peach",
    name: "ピーチ",
    css: [
      "radial-gradient(circle at 25% 22%, #fb923c 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #f43f5e 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #ec4899 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #fbbf24 0%, transparent 55%)",
      "linear-gradient(135deg, #ea580c, #be185d)",
    ].join(", "),
  },
  {
    id: "mint",
    name: "ミント",
    css: [
      "radial-gradient(circle at 25% 22%, #a7f3d0 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #99f6e4 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #67e8f9 0%, transparent 55%)",
      "radial-gradient(circle at 22% 82%, #d9f99d 0%, transparent 55%)",
      "linear-gradient(135deg, #34d399, #22d3ee)",
    ].join(", "),
  },
  {
    id: "cosmic",
    name: "コスミック",
    css: [
      "radial-gradient(circle at 25% 22%, #6d28d9 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #be185d 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #1e1b4b 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #7c3aed 0%, transparent 55%)",
      "linear-gradient(135deg, #4c1d95, #0f0c29)",
    ].join(", "),
  },
  {
    id: "nebula",
    name: "ネビュラ",
    css: [
      "radial-gradient(circle at 25% 22%, #ec4899 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #3b82f6 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #6366f1 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #8b5cf6 0%, transparent 55%)",
      "linear-gradient(135deg, #1e3a8a, #831843)",
    ].join(", "),
  },
  {
    id: "cherry",
    name: "チェリー",
    css: [
      "radial-gradient(circle at 25% 22%, #fda4af 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #be123c 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #881337 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #f43f5e 0%, transparent 55%)",
      "linear-gradient(135deg, #e11d48, #4c0519)",
    ].join(", "),
  },
  {
    id: "arctic",
    name: "アークティック",
    css: [
      "radial-gradient(circle at 25% 22%, #bae6fd 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #818cf8 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #1e3a8a 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #67e8f9 0%, transparent 55%)",
      "linear-gradient(135deg, #38bdf8, #312e81)",
    ].join(", "),
  },
  {
    id: "gold",
    name: "ゴールド",
    css: [
      "radial-gradient(circle at 25% 22%, #fde68a 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #f59e0b 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #92400e 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #fbbf24 0%, transparent 55%)",
      "linear-gradient(135deg, #d97706, #451a03)",
    ].join(", "),
  },
  {
    id: "coral",
    name: "コーラル",
    css: [
      "radial-gradient(circle at 25% 22%, #fb7185 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #fdba74 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #fda4af 0%, transparent 55%)",
      "radial-gradient(circle at 22% 82%, #fef08a 0%, transparent 55%)",
      "linear-gradient(135deg, #f97316, #fb7185)",
    ].join(", "),
  },
  {
    id: "twilight",
    name: "トワイライト",
    css: [
      "radial-gradient(circle at 25% 22%, #fb923c 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #c026d3 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #1e3a8a 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #f472b6 0%, transparent 55%)",
      "linear-gradient(135deg, #ea580c, #1e1b4b)",
    ].join(", "),
  },
  {
    id: "matcha",
    name: "抹茶",
    css: [
      "radial-gradient(circle at 25% 22%, #bef264 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #fef3c7 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #65a30d 0%, transparent 55%)",
      "radial-gradient(circle at 22% 82%, #a3e635 0%, transparent 55%)",
      "linear-gradient(135deg, #84cc16, #3f6212)",
    ].join(", "),
  },
  {
    id: "graphite",
    name: "グラファイト",
    css: [
      "radial-gradient(circle at 25% 22%, #71717a 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #3f3f46 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #18181b 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #a1a1aa 0%, transparent 55%)",
      "linear-gradient(135deg, #52525b, #09090b)",
    ].join(", "),
  },
  {
    id: "rose-quartz",
    name: "ローズクォーツ",
    css: [
      "radial-gradient(circle at 25% 22%, #c084fc 0%, transparent 55%)",
      "radial-gradient(circle at 78% 28%, #fda4af 0%, transparent 55%)",
      "radial-gradient(circle at 75% 80%, #6b21a8 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #f472b6 0%, transparent 55%)",
      "linear-gradient(135deg, #a855f7, #831843)",
    ].join(", "),
  },
  {
    id: "sakura",
    name: "桜",
    css: [
      "radial-gradient(circle at 25% 22%, #f9a8d4 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #fbcfe8 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #be185d 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #f472b6 0%, transparent 55%)",
      "linear-gradient(135deg, #ec4899, #831843)",
    ].join(", "),
  },
  {
    id: "deep-sea",
    name: "ディープシー",
    css: [
      "radial-gradient(circle at 25% 22%, #0e7490 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #1e3a8a 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #042f2e 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #0891b2 0%, transparent 55%)",
      "linear-gradient(135deg, #155e75, #022c22)",
    ].join(", "),
  },
  {
    id: "neon",
    name: "ネオン",
    css: [
      "radial-gradient(circle at 25% 22%, #22d3ee 0%, transparent 55%)",
      "radial-gradient(circle at 78% 25%, #d946ef 0%, transparent 55%)",
      "radial-gradient(circle at 78% 80%, #0f172a 0%, transparent 60%)",
      "radial-gradient(circle at 22% 82%, #a3e635 0%, transparent 55%)",
      "linear-gradient(135deg, #2563eb, #831843)",
    ].join(", "),
  },
] as const;

const GRADIENT_BY_ID = new Map(
  ICON_GRADIENT_PALETTE.map((g) => [g.id, g] as const),
);

export function isGradientToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(GRADIENT_PREFIX) &&
    GRADIENT_BY_ID.has(value.slice(GRADIENT_PREFIX.length))
  );
}

export function gradientToken(id: string): string {
  return `${GRADIENT_PREFIX}${id}`;
}

export function gradientIdFromToken(value: string): string | null {
  if (!value.startsWith(GRADIENT_PREFIX)) return null;
  const id = value.slice(GRADIENT_PREFIX.length);
  return GRADIENT_BY_ID.has(id) ? id : null;
}

// ---- Resolution & helpers --------------------------------------------------

export function isIconColor(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (PALETTE_SET.has(value)) return true;
  return isGradientToken(value);
}

// ソリッド色を返す。グラデーションが保存されていた場合は DEFAULT を返す
// (アバター背景以外、token 表現を扱えない箇所のフォールバック用)。
export function resolveIconColor(value: string | null | undefined): string {
  if (typeof value === "string" && PALETTE_SET.has(value)) return value;
  return DEFAULT_ICON_COLOR;
}

// アバター背景に貼り付ける CSS を返す。ソリッド色なら backgroundColor、
// グラデーションなら backgroundImage を埋める。両方の描画箇所で使う。
export function iconBackgroundStyle(
  value: string | null | undefined,
): CSSProperties {
  if (typeof value === "string") {
    const gradId = gradientIdFromToken(value);
    if (gradId) {
      const g = GRADIENT_BY_ID.get(gradId);
      if (g) return { backgroundImage: g.css };
    }
    if (PALETTE_SET.has(value)) return { backgroundColor: value };
  }
  return { backgroundColor: DEFAULT_ICON_COLOR };
}

// ソリッド/グラデーション/未設定にかかわらず CSS を返す。
// 引数 fallback は icon_color が NULL のときに使う user_id 等のキー。
export function iconBackgroundStyleOrAuto(
  value: string | null | undefined,
  fallbackKey: string,
): CSSProperties {
  if (typeof value === "string" && (PALETTE_SET.has(value) || isGradientToken(value))) {
    return iconBackgroundStyle(value);
  }
  return { backgroundColor: deterministicIconColor(fallbackKey) };
}

// user_id から決定的に色を引く (display_name 未設定でも区別可能にする用)。
// profiles.icon_color が NULL のときの自動色として使う。
export function deterministicIconColor(id: string): IconSolid {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ICON_COLOR_PALETTE[h % ICON_COLOR_PALETTE.length];
}

// Backwards-compatible alias for the previous narrower type name.
export type IconColor = IconSolid;

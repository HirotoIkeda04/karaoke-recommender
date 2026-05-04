// ユーザーアイコンの背景色パレット。
// DB には #rrggbb の小文字で保存し、UI ではこのリストの中から選択させる。
// hue 順に並べてあるのでパレット表示時もそのまま使える。
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

export type IconColor = (typeof ICON_COLOR_PALETTE)[number];

// 既定色 (icon_color が NULL のユーザー向けフォールバック)。
export const DEFAULT_ICON_COLOR: IconColor = "#ec4899";

const PALETTE_SET: ReadonlySet<string> = new Set(ICON_COLOR_PALETTE);

export function isIconColor(value: unknown): value is IconColor {
  return typeof value === "string" && PALETTE_SET.has(value);
}

export function resolveIconColor(value: string | null | undefined): string {
  return isIconColor(value) ? value : DEFAULT_ICON_COLOR;
}

// user_id から決定的に色を引く (display_name 未設定でも区別可能にする用)。
// profiles.icon_color が NULL のときの自動色として使う。
export function deterministicIconColor(id: string): IconColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return ICON_COLOR_PALETTE[h % ICON_COLOR_PALETTE.length];
}

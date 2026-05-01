// アプリ内 WebView (LINE / Instagram / Facebook / X 等) を UA から検知する。
// Google OAuth は埋め込み WebView を一律ブロックする (disallowed_useragent / Error 403) ため、
// ログイン前にここで弾いて案内を出す必要がある。
//
// 参考: https://developers.googleblog.com/en/modernizing-oauth-interactions-in-native-apps-for-better-usability-and-security/

export type InAppBrowser =
  | "line"
  | "instagram"
  | "facebook"
  | "twitter"
  | "tiktok"
  | "other";

export interface InAppBrowserInfo {
  inApp: boolean;
  kind: InAppBrowser | null;
}

export function detectInAppBrowser(userAgent: string): InAppBrowserInfo {
  const ua = userAgent.toLowerCase();

  if (ua.includes(" line/") || ua.includes("line/")) {
    return { inApp: true, kind: "line" };
  }
  if (ua.includes("instagram")) return { inApp: true, kind: "instagram" };
  if (ua.includes("fbav") || ua.includes("fban") || ua.includes("fb_iab")) {
    return { inApp: true, kind: "facebook" };
  }
  if (ua.includes("twitter")) return { inApp: true, kind: "twitter" };
  if (ua.includes("tiktok") || ua.includes("musical_ly")) {
    return { inApp: true, kind: "tiktok" };
  }

  return { inApp: false, kind: null };
}

const LABELS: Record<InAppBrowser, string> = {
  line: "LINE",
  instagram: "Instagram",
  facebook: "Facebook",
  twitter: "X (Twitter)",
  tiktok: "TikTok",
  other: "アプリ内ブラウザ",
};

export function inAppBrowserLabel(kind: InAppBrowser | null): string {
  return kind ? LABELS[kind] : LABELS.other;
}

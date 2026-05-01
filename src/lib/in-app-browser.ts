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

export type MobileOS = "ios" | "android" | "other";

export function detectMobileOS(userAgent: string): MobileOS {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (ua.includes("android")) return "android";
  return "other";
}

// 現在開いている URL を Chrome で開かせるための scheme 付き URL を構築する。
//
// iOS: googlechromes:// (https の場合) / googlechrome:// (http の場合) に prefix を差し替える。
//   Chrome がインストールされていない場合は何も起きず元ページに留まるため、
//   呼び出し側で visibilitychange + timeout でフォールバック判定が必要。
//
// Android: intent:// scheme で Chrome パッケージを指定。S.browser_fallback_url を付けることで
//   Chrome 未インストール時はそのフォールバック URL を OS が開いてくれる。
export function buildChromeSchemeUrl(currentUrl: string, os: MobileOS): string | null {
  if (os === "ios") {
    if (currentUrl.startsWith("https://")) {
      return "googlechromes://" + currentUrl.slice("https://".length);
    }
    if (currentUrl.startsWith("http://")) {
      return "googlechrome://" + currentUrl.slice("http://".length);
    }
    return null;
  }

  if (os === "android") {
    const url = new URL(currentUrl);
    const fallback = encodeURIComponent(currentUrl);
    // intent://<host><path><query>#Intent;scheme=<scheme>;package=com.android.chrome;S.browser_fallback_url=<fallback>;end
    return (
      "intent://" +
      url.host +
      url.pathname +
      url.search +
      url.hash +
      "#Intent;scheme=" +
      url.protocol.replace(":", "") +
      ";package=com.android.chrome;S.browser_fallback_url=" +
      fallback +
      ";end"
    );
  }

  return null;
}

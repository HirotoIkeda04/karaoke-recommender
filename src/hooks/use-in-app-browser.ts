"use client";

import { useSyncExternalStore } from "react";

import {
  detectInAppBrowser,
  detectMobileOS,
  type InAppBrowser,
  type MobileOS,
} from "@/lib/in-app-browser";

export interface InAppBrowserState {
  inApp: boolean;
  kind: InAppBrowser | null;
  os: MobileOS;
}

// サーバーでは UA を見ない。ハイドレーション後に一度だけ実際の値へ
// 切り替わる (effect で setState すると余計な再レンダーを挟むため、
// useSyncExternalStore の server/client スナップショットで表現する)。
const SERVER_STATE: InAppBrowserState = {
  inApp: false,
  kind: null,
  os: "other",
};

// UA はページの寿命中変わらないので一度だけ判定して使い回す。
// (useSyncExternalStore は同じ値なら同じ参照を返すことを要求する)
let clientState: InAppBrowserState | null = null;

function getClientState(): InAppBrowserState {
  if (typeof navigator === "undefined") return SERVER_STATE;
  if (!clientState) {
    const info = detectInAppBrowser(navigator.userAgent);
    clientState = {
      inApp: info.inApp,
      kind: info.kind,
      os: detectMobileOS(navigator.userAgent),
    };
  }
  return clientState;
}

function getServerState(): InAppBrowserState {
  return SERVER_STATE;
}

/** UA は変化しないので購読するものが無い */
function subscribe(): () => void {
  return () => {};
}

/** 今アプリ内ブラウザ (LINE / Instagram 等) で開かれているか */
export function useInAppBrowser(): InAppBrowserState {
  return useSyncExternalStore(subscribe, getClientState, getServerState);
}

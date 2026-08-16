/**
 * 「意図しないログアウト」の証跡を端末側に残す。
 *
 * iPhone のホーム画面追加 (PWA) でしばらく経つとログアウトされている、
 * という症状を追うための計測。Supabase 側のログにはリフレッシュ失敗
 * (POST /auth/v1/token の 4xx) が残っていないので、サーバーからは
 * 「そもそもリフレッシュが試みられていない = ブラウザから auth Cookie が
 * 消えている」ようにしか見えない。それを端末側で確かめる。
 *
 * ログイン状態で開くたびに印を localStorage へ残し、ゲストとして描かれた
 * 時にその印が残っていたら意図しないログアウトと判定する。判定は 3 通りで、
 * どれになるかで原因が切り分けられる:
 *
 * - `cookie-gone`     localStorage は生きていて auth Cookie だけ消えた。
 *                     Cookie 単独の寿命切れ / 削除 (ITP の上限など)。
 * - `cookie-unusable` Cookie は残っているがサーバーがセッションを組めない。
 *                     中身の破損・チャンク欠け・回転済みトークンなど。
 * - 何も出ない        localStorage ごと消えている = サイトデータ全体の削除。
 *
 * Supabase の auth Cookie は httpOnly: false なので、その有無はここから
 * 直接見える (@supabase/ssr の既定。ブラウザ側クライアントが読む必要がある)。
 */

/** ログイン状態で開いた印 */
const MARK_KEY = "kyokumoku.auth.signedIn.v1";
/** 直近の意図しないログアウト */
const DROP_KEY = "kyokumoku.auth.drop.v1";
/** 同一タブ内での変更を通知する (useSyncExternalStore 用) */
const CHANGE_EVENT = "kyokumoku:auth-drop-change";

/** Supabase の auth Cookie。チャンク分割されると `.0` `.1` が付く */
const AUTH_COOKIE_RE = /^sb-.+-auth-token(\.\d+)?$/;

interface SignedInMark {
  /** このログインで最初に開いた時刻 (ms) */
  firstAt: number;
  /** ログイン状態で最後に開いた時刻 (ms) */
  lastAt: number;
}

export type AuthDropKind = "cookie-gone" | "cookie-unusable";

export interface AuthDrop {
  kind: AuthDropKind;
  /** 検出時刻 (ms) */
  at: number;
  /** ログインしてからログアウトされるまで (ms) */
  sessionAgeMs: number;
  /** 最後にログイン状態で開いてからの間隔 (ms) */
  awayMs: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    // localStorage 不可 (プライベートモード等) や壊れた値。計測は諦める
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 保存できなくても本来の動作には影響しない */
  }
}

function remove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* 同上 */
  }
}

function notifyChange(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** auth Cookie が 1 つでも残っているか */
function hasAuthCookie(): boolean {
  return document.cookie.split("; ").some((pair) => {
    const eq = pair.indexOf("=");
    if (eq <= 0) return false;
    return (
      AUTH_COOKIE_RE.test(pair.slice(0, eq)) && pair.slice(eq + 1).length > 0
    );
  });
}

/** ログイン状態で開いた印を更新する。初回のログイン時刻は保つ */
export function markSignedIn(): void {
  const prev = readJson<SignedInMark>(MARK_KEY);
  const now = Date.now();
  writeJson(MARK_KEY, {
    firstAt: prev?.firstAt ?? now,
    lastAt: now,
  } satisfies SignedInMark);
}

/** 自分でログアウトした時に印を消す (意図しないログアウトと混ざらないように) */
export function clearSignedInMark(): void {
  remove(MARK_KEY);
  remove(DROP_KEY);
  notifyChange();
}

/**
 * 直前までログインしていたなら、意図しないログアウトとして記録する。
 * 最初からゲストの人 (印が無い) には何も起きない。
 *
 * @param kind 種別。省略時は auth Cookie の有無から判定する。middleware が
 *   先に Cookie を消してからログイン画面へ飛ばす経路では、その判定が
 *   使えないのでサーバー側の判断を渡す。
 */
export function recordDrop(kind?: AuthDropKind): void {
  const mark = readJson<SignedInMark>(MARK_KEY);
  if (!mark) return;

  const now = Date.now();
  writeJson(DROP_KEY, {
    kind: kind ?? (hasAuthCookie() ? "cookie-unusable" : "cookie-gone"),
    at: now,
    sessionAgeMs: now - mark.firstAt,
    awayMs: now - mark.lastAt,
  } satisfies AuthDrop);
  // 印は消す。残すと、ログインし直すまでゲストで開くたびに再検出される
  remove(MARK_KEY);
  notifyChange();
}

export function clearLastDrop(): void {
  remove(DROP_KEY);
  notifyChange();
}

export function subscribeDrop(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

/**
 * 直近の意図しないログアウトを「生の文字列のまま」返す。
 * useSyncExternalStore のスナップショットは呼ぶたびに同じ参照でないと
 * 無限ループになるので、ここではパースせず文字列 (プリミティブ) を返す。
 */
export function readDropRaw(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DROP_KEY);
  } catch {
    return null;
  }
}

export function serverDropRaw(): null {
  return null;
}

export function parseDrop(raw: string | null): AuthDrop | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthDrop;
  } catch {
    return null;
  }
}

/** 「約 3 日」のような粗い表記。切り分けに要る精度はこれで足りる */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)} 分`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 時間`;
  return `${Math.round(hours / 24)} 日`;
}

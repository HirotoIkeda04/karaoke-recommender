// PWA インストール要件 (Android Chrome の WebAPK 化) を満たすための最小 Service Worker。
// キャッシュ・オフライン対応は意図的に行わない (認証アプリのため副作用回避)。
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Chrome のインストール判定が fetch ハンドラの存在を要求するため、
// no-op の listener を登録しておく (respondWith しない = ネットワークそのまま)。
self.addEventListener("fetch", () => {});

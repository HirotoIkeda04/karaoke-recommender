import { AppHeader } from "@/components/app-header";
import { AppBottomNav } from "@/components/app-bottom-nav";
import { AuthDropNotice } from "@/components/auth-drop-notice";
import { DeckDetailProvider } from "@/components/deck-detail-context";
import { GuestRatingsImporter } from "@/components/guest-ratings-importer";
import { InAppBrowserGate } from "@/components/in-app-browser-gate";
import { SessionProvider } from "@/components/session-provider";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
  songSheet,
}: {
  children: React.ReactNode;
  songSheet: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 未ログインでもここは通す。どのパスをゲストに開放するかは middleware
  // (src/proxy.ts の GUEST_PATHS) が一元管理していて、開放していないパスは
  // ここへ来る前に /login へ飛ぶ。二重にガードすると「ゲスト可のページなのに
  // レイアウトで弾かれる」という食い違いを生むので、判定は middleware に寄せる。
  const isGuest = !session?.user;

  return (
    <SessionProvider isGuest={isGuest}>
      {/* ゲスト中に付けた評価が localStorage に残っていたら DB へ移す */}
      <GuestRatingsImporter />
      {/* 意図しないログアウトに気づけるようにする (黙ってゲストに落ちない) */}
      <AuthDropNotice />
      {/* LINE 等のアプリ内ブラウザなら、まず外部ブラウザへの導線を出す */}
      <InAppBrowserGate />
      {/* min-h-dvh: 動的ビューポート高 (iOS Safari の URL バー伸縮に追従、
          100vh のような固定値ではなく現在の表示領域を毎フレーム反映する) */}
      {/* ホームのデッキが詳細表示に入ったらナビを引っ込める。デッキと
          ナビは兄弟なので、その状態だけ Provider 経由で共有する */}
      <DeckDetailProvider>
        <div className="flex min-h-dvh flex-col">
          <AppHeader />
          {/* main の bottom padding: 浮いた BottomNav (バー 3.5rem + 下の余白
              max(0.75rem, safe-area)) を必ず上回る値。5rem + safe-area なら
              safe-area の有無どちらでも 0.75rem 以上のクリアランスが残る。 */}
          <main className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))]">
            {children}
          </main>
          <AppBottomNav />
          {songSheet}
        </div>
      </DeckDetailProvider>
    </SessionProvider>
  );
}

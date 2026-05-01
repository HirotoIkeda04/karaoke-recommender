import Link from "next/link";

export const metadata = {
  title: "プライバシーポリシー | SetoriSetolu",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 text-zinc-800 dark:text-zinc-200">
      <h1 className="text-2xl font-semibold">プライバシーポリシー</h1>
      <p className="mt-2 text-xs text-zinc-500">最終更新: 2026 年 4 月 27 日</p>

      <section className="mt-6 space-y-3 text-sm leading-relaxed">
        <p>
          SetoriSetolu(以下「本アプリ」)は、ユーザーのプライバシーを尊重し、
          以下の方針に従ってデータを取り扱います。
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">1. 取得するデータ</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-relaxed">
        <li>
          Google アカウントの認証情報(メールアドレス、表示名、プロフィール画像)
        </li>
        <li>
          ユーザーが行った楽曲評価データ(楽曲、評価、メモ、評価日時)
        </li>
        <li>
          任意で Spotify 連携を行った場合:
          <ul className="mt-1 list-[circle] space-y-0.5 pl-6">
            <li>Spotify ユーザー ID および表示名</li>
            <li>直近の再生履歴(最大 50 曲)</li>
            <li>よく聴く曲(過去 4 週間 / 半年 / 全期間 各最大 50 曲)</li>
            <li>Spotify で「お気に入り」(❤️)登録された曲</li>
          </ul>
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">2. データの利用目的</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-relaxed">
        <li>本アプリ内でユーザーの評価データを表示</li>
        <li>
          Spotify でよく聴く曲を、楽曲評価画面でハイライト表示する
        </li>
        <li>ユーザーの音域を統計的に推定して表示</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">3. データの第三者提供</h2>
      <p className="mt-3 text-sm leading-relaxed">
        取得したデータを第三者に提供したり、販売することは一切行いません。
      </p>

      <h2 className="mt-8 text-lg font-semibold">4. データの保管</h2>
      <p className="mt-3 text-sm leading-relaxed">
        データは Supabase(認証およびデータベース)、Vercel(アプリケーションホスティング)上に保管されます。
        Spotify から取得したアクセストークンおよびリフレッシュトークンは、AES-256-GCM
        による暗号化を施したうえで保管します。
      </p>

      <h2 className="mt-8 text-lg font-semibold">5. データの削除</h2>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-sm leading-relaxed">
        <li>
          Spotify 連携の解除:プロフィール画面から連携を解除すると、Spotify から取得したトークン・楽曲履歴を全て削除します。
        </li>
        <li>
          アカウント削除:本アプリのアカウント削除をご希望の場合は、下記のお問い合わせ先までご連絡ください。
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">6. お問い合わせ</h2>
      <p className="mt-3 text-sm leading-relaxed">
        本ポリシーに関するお問い合わせは、{" "}
        <a
          href="mailto:hiroto.ikeda.oka@gmail.com"
          className="text-pink-600 underline dark:text-pink-400"
        >
          hiroto.ikeda.oka@gmail.com
        </a>{" "}
        までご連絡ください。
      </p>

      <p className="mt-10">
        <Link
          href="/profile"
          className="text-sm text-zinc-600 underline dark:text-zinc-400"
        >
          ← プロフィールに戻る
        </Link>
      </p>
    </main>
  );
}

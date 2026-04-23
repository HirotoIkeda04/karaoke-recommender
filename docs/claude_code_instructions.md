# Claude Code 依頼書

カラオケ推薦アプリ フェーズ1 の実装を Claude Code に依頼する際のプロンプト集。
ステップごとに分割しており、**1ステップずつ順番に依頼する**ことを推奨。

---

## 前提: Claude Code の起動準備

### プロジェクトディレクトリの作成

```bash
mkdir karaoke-recommender
cd karaoke-recommender
```

### 添付すべきドキュメント

Claude Code 起動時に以下3ファイルを `docs/` に配置しておく:

```
karaoke-recommender/
├── docs/
│   ├── karaoke_app_phase1_plan.md      # 全体方針
│   ├── scraper_design_spec.md          # スクレイパ仕様書
│   └── database_design_notes.md        # DB設計解説
├── migrations/
│   └── 001_initial_schema.sql          # DB マイグレーション
└── (以下 Claude Code が作成)
```

### Claude Code 起動時の初期コンテキスト

Claude Code を `claude` コマンドで起動した直後、以下を最初に伝える:

```
これからカラオケ推薦アプリのフェーズ1を実装します。
docs/ 配下に3つの設計ドキュメントがあるので、まず全て読んでください。

- docs/karaoke_app_phase1_plan.md(全体方針)
- docs/scraper_design_spec.md(スクレイパ仕様)
- docs/database_design_notes.md(DB設計)

読み終わったら、設計上の不明点や懸念点があれば質問してください。
質問が無ければ、こちらから順次ステップを指示していきます。
```

Claude Code が質問してきた場合は、疑問点を解消してから進める。

---

## 全体ステップ構成

| Step | 内容 | 所要 | 依存 |
|------|------|-----|------|
| 1 | プロジェクト初期化(Next.js + Supabase) | 1-2h | - |
| 2 | DB適用と型生成 | 30min | Step 1 |
| 3 | スクレイパ実装(カラ音) | 2-3h | Step 1 |
| 4 | Spotify連携 + seed投入 | 1-2h | Step 2, 3 |
| 5 | 認証画面 | 1h | Step 2 |
| 6 | スワイプ評価画面(メイン) | 2-3h | Step 5 |
| 7 | 一覧・検索・詳細画面 | 2-3h | Step 6 |
| 8 | プロフィール画面(音域推定) | 1h | Step 6 |
| 9 | デプロイ | 1h | Step 8 |

**合計: 11-16時間**。週末2〜3日で完成。

---

## Step 1: プロジェクト初期化

### プロンプト

```
Step 1: Next.js プロジェクトを初期化してください。

要件:
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- ESLint + Prettier
- パッケージマネージャ: pnpm

以下の依存関係を追加:
- @supabase/supabase-js
- @supabase/ssr (Next.js SSR 対応)
- shadcn/ui (CLI で init して必要なコンポーネントは適宜追加)
- framer-motion (スワイプUI 用)
- lucide-react (アイコン)
- zod (バリデーション)

ディレクトリ構造:
src/
├── app/             (App Router ページ)
├── components/      (UI コンポーネント)
├── lib/             (Supabase クライアント、ユーティリティ)
├── types/           (型定義)
└── hooks/           (React hooks)

作成後、以下を確認:
1. `pnpm dev` で起動確認
2. Tailwind が効いているか(トップページに色付きテキストを1行入れて確認)
3. shadcn/ui の Button コンポーネントが動くか

環境変数ファイルも用意:
- .env.local.example(テンプレート、Git に入れる)
- .env.local(実値、.gitignore に追加)

.env.local.example に以下を記載:
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

完了したら、作成したファイルのリストと起動確認結果を報告してください。
```

### 完了基準

- [ ] `pnpm dev` で `localhost:3000` が表示される
- [ ] Tailwind が効いている
- [ ] shadcn/ui Button が表示される
- [ ] `.env.local.example` が存在
- [ ] Git リポジトリが初期化されている

---

## Step 2: DB適用と型生成

### 事前準備(ユーザー側作業)

Claude Code に渡す前に済ませる:

1. Supabase Dashboard でプロジェクト作成
2. Project URL / anon key / service role key をメモ
3. `001_initial_schema.sql` を SQL Editor に貼り付けて実行
4. 実行成功を確認(`songs`, `evaluations` テーブル、ビュー、関数が作られる)
5. Google OAuth を Authentication > Providers で有効化
   - Google Cloud Console で OAuth クライアント作成
   - Redirect URI: `https://<project>.supabase.co/auth/v1/callback`
6. `.env.local` に認証情報を記入

### プロンプト

```
Step 2: Supabase の接続セットアップと TypeScript 型生成を行います。

前提:
- Supabase プロジェクトは既に作成済み
- migrations/001_initial_schema.sql は適用済み
- .env.local に接続情報が入っている

実施内容:
1. src/lib/supabase/ 配下に Supabase クライアントを作成
   - client.ts: ブラウザ用クライアント (createBrowserClient)
   - server.ts: サーバーコンポーネント用クライアント (createServerClient)
   - admin.ts: service_role 用(seed投入・管理作業用)

2. Supabase CLI で TypeScript 型を生成
   - コマンド例: supabase gen types typescript --project-id <id> > src/types/database.ts
   - 型生成スクリプトを package.json に追加: "db:types": "..."

3. 型生成後、lib/supabase/*.ts で Database 型を適用

4. 動作確認用のテストページ app/test-db/page.tsx を作成
   - songs テーブルから5件取得して表示
   - 0件でも表示が崩れないこと

docs/database_design_notes.md を参考に、RLS とビューの挙動を理解した上で実装してください。

完了したら、test-db ページでの取得結果とファイル構成を報告してください。
```

### 完了基準

- [ ] `src/lib/supabase/{client,server,admin}.ts` が動く
- [ ] `src/types/database.ts` が生成されている
- [ ] `/test-db` でクエリが実行できる(0件でも可)
- [ ] TypeScript のコンパイルエラーがない

---

## Step 3: スクレイパ実装

### プロンプト

```
Step 3: カラ音(karaoto.net)のスクレイパを実装します。

詳細は docs/scraper_design_spec.md を参照してください。
Next.js プロジェクトとは別ディレクトリ scraper/ に、Python で実装します。

実装順序(各ステップで動作確認してから次へ):

1. scraper/note_converter.py
   - 仕様書の MIDI 変換テーブルを実装
   - ユニットテスト scraper/tests/test_note_converter.py も作成
   - hiA=69, mid2G=67, lowG=43 などの主要値で検証

2. scraper/parse_karaoto.py
   - HTML → 曲リストへのパーサ
   - まず1ページ分の HTML をローカルファイル(fixture)から読む形で実装
   - 仕様書のパース正規表現を使う
   - 太字(<strong>)の曲を is_popular=True にする
   - アーティスト名(## ヘッダ)・曲名・音域・リリース年・アルバム名を抽出

3. scraper/scrape_karaoto.py
   - 実際に karaoto.net にアクセス
   - 事前チェック: robots.txt を取得して Disallow を確認、違反なら abort
   - User-Agent 設定
   - リクエスト間隔2秒
   - HTML をローカルキャッシュ(./cache/karaoto/max_key_{N}.html)に保存
   - キャッシュがあればそれを使う
   - 対象ページは max_key/31 〜 max_key/44

4. scraper/main.py
   - 全ページをスクレイプ → パース → songs_raw.json として出力
   - 統計レポート(何曲取れたか、アーティスト数など)を scraping_report.md として出力

実行前の確認事項を README.md にも記載してください。

依存パッケージ:
- requests, beautifulsoup4, python-dotenv, rapidfuzz(後続ステップで使用)
- pytest(テスト用)

scraper/pyproject.toml または requirements.txt を用意すること。

動作確認:
- pytest でノート変換のテストが通る
- main.py を実行して songs_raw.json が生成される
- 1000曲以上取得できていること
```

### 完了基準

- [ ] `note_converter.py` のユニットテストが全て通る
- [ ] `main.py` 実行で `songs_raw.json` が生成される
- [ ] 1000曲以上取得できている
- [ ] `scraping_report.md` が自動生成される
- [ ] robots.txt チェックが機能している

---

## Step 4: Spotify連携 + seed投入

### 事前準備(ユーザー側作業)

1. Spotify Developer Dashboard でアプリ作成
2. Client ID / Client Secret を取得
3. `.env.local` と `scraper/.env` に記入

### プロンプト

```
Step 4: Spotify API 連携と Supabase への seed 投入を実装します。

4-a. Spotify API クライアント (scraper/fetch_spotify.py)

要件:
- Client Credentials フローで認証(ユーザー認証不要)
- トークンを取得 → キャッシュ(有効期限を考慮)
- search エンドポイントで曲検索
- 結果から track_id、画像URL(640/300/64)、リリース年を抽出
- レート制限: 呼び出し間隔 0.2秒

4-b. マッチングロジック (scraper/matcher.py)

仕様書 §6 に従い、段階的フォールバック:
1. 厳密マッチ: track:{title} artist:{artist}
2. 緩和マッチ: 記号・カッコ除去
3. アーティスト名のみ + 類似度スコア >= 0.85

rapidfuzz を使用。

アーティスト名エイリアス辞書:
scraper/artist_alias.json を手動メンテ用として用意。
主要な表記揺れ(ONE OK ROCK, SEKAI NO OWARI, Mr.Children, B'z 等)を登録。

4-c. 統合スクリプト (scraper/enrich_with_spotify.py)

- songs_raw.json を読み込む
- 各曲を Spotify で検索
- マッチ成功 → songs_seed.json に記録
- マッチ失敗 → unmatched.csv に記録
- 進捗を標準出力(tqdm 使用)

4-d. Supabase への seed 投入 (Next.js 側)

scripts/seed_songs.ts (TypeScript) を作成:
- scraper/output/songs_seed.json を読み込む
- service_role クライアントで songs.upsert(onConflict: 'spotify_track_id')
- 100件ずつバッチ処理
- 進捗表示

package.json に追加:
"seed": "tsx scripts/seed_songs.ts"

動作確認:
- enrich_with_spotify.py 実行で songs_seed.json が生成される
- マッチ率 85% 以上(unmatched.csv の行数で確認)
- pnpm run seed で Supabase にデータが入る
- /test-db ページでジャケ画像付きで表示される
```

### 完了基準

- [ ] `songs_seed.json` が生成され、マッチ率85%以上
- [ ] Supabase の `songs` テーブルに1000曲以上入っている
- [ ] `/test-db` でジャケ画像と音域が表示される
- [ ] `unmatched.csv` が手動確認できる形式

---

## Step 5: 認証画面

### プロンプト

```
Step 5: Google OAuth による認証を実装します。

実装内容:

1. ミドルウェア (src/middleware.ts)
   - Supabase SSR のセッション管理
   - 認証が必要なパスを定義: /home, /library, /profile
   - 未ログイン時は /login にリダイレクト

2. ログイン画面 (app/login/page.tsx)
   - 中央に大きく「Google でログイン」ボタン
   - Supabase の signInWithOAuth({ provider: 'google' })
   - Redirect URL: /auth/callback
   - アプリ名とキャッチコピー(仮)を表示
   - ログイン済みなら /home にリダイレクト

3. コールバック処理 (app/auth/callback/route.ts)
   - Supabase SSR 標準の exchangeCodeForSession
   - 成功後 /home へ、エラー時 /login?error=... へ

4. ログアウト API (app/auth/logout/route.ts)
   - POST で signOut
   - /login にリダイレクト

5. ルートレイアウトの改修 (app/layout.tsx)
   - ヘッダーに「ログアウト」ボタンを追加(ログイン時のみ)
   - ユーザーのプロフィール画像(Google アバター)を表示

6. 未使用になる /test-db ページは認証ガード配下に移動するか削除

Tailwind + shadcn/ui で以下のページを作成:
- /login: ログインページ(未ログイン状態のみアクセス可能)
- /home: 仮のダッシュボード(ログイン必須、「ようこそ {ユーザー名} さん」のみでOK)

デザインは控えめに、クリーンな印象で。カラオケアプリらしい遊びは後続ステップで追加。

動作確認:
- ログアウト状態で /home にアクセス → /login にリダイレクト
- Google ログイン成功 → /home に遷移、ユーザー名が表示される
- ログアウトボタン押下 → /login に戻る
```

### 完了基準

- [ ] Google OAuth ログインが動作
- [ ] 未ログイン時に認証ガードが効く
- [ ] ログアウトが動作
- [ ] ユーザー名/アバターが表示される

---

## Step 6: スワイプ評価画面(メイン機能)

### プロンプト

```
Step 6: アプリのメイン体験となるスワイプ評価画面を実装します。

仕様:

画面: /home

レイアウト:
- 画面中央に1枚のカード(ジャケ画像 + 曲情報)
- カードの下に4つのボタン: ❌ 苦手 / △ 普通 / ⭕ 得意 / 🔖 練習中
- カードをスワイプでも評価可能:
  - 左スワイプ = 苦手
  - 右スワイプ = 得意
  - 下スワイプ = 普通
  - 上スワイプ = 練習中
- スワイプ後、次の曲カードが出現

カード内容:
- ジャケット画像(300x300)
- 曲名(大きめ)
- アーティスト名
- リリース年
- 音域表示:
  - 地声: {mid1F} 〜 {mid2G}
  - 裏声: {hiC} (NULLの場合は表示しない)
  - MIDIは UI では表示せず、カラオケ表記に変換

実装:

1. src/lib/midi.ts
   - MIDI → カラオケ表記 の変換関数(scraper/note_converter.py のTS版)
   - 主要値でユニットテスト(vitest)

2. src/hooks/useUnratedSongs.ts
   - Supabase RPC get_unrated_songs() を呼ぶ
   - スタック形式で曲を保持(次カードを先読み)
   - 評価後は先頭を捨てて次カードを表示
   - 残り3枚になったら追加取得

3. src/components/SongCard.tsx
   - カード本体
   - framer-motion でドラッグ + 回転アニメーション
   - スワイプ閾値を超えたら onSwipe(direction) 発火

4. src/components/RatingButtons.tsx
   - 下部の4ボタン
   - 各ボタンのキーボードショートカット(1/2/3/4)

5. app/home/page.tsx
   - useUnratedSongs + SongCard + RatingButtons を組み合わせ
   - 評価を Supabase の evaluations テーブルに upsert
   - 楽観的UI更新(APIレスポンスを待たず次カードへ)

6. エッジケース:
   - 未評価曲ゼロ時: 「全曲評価済みです!」の表示
   - ネットワークエラー時: トースト表示 + 手動リトライ
   - 連打対策: 評価直後は1秒ボタン無効化

動作確認:
- 20曲ほど評価できることを確認
- evaluations テーブルに記録されることを DB で確認
- 同じ曲が再出現しないこと
- スワイプとボタンどちらでも評価できること
```

### 完了基準

- [ ] スワイプとボタンの両方で評価できる
- [ ] 評価が DB に保存される
- [ ] 評価済みの曲は再出現しない
- [ ] 未評価ゼロ時の表示が出る
- [ ] キーボードショートカットが効く

---

## Step 7: 一覧・検索・詳細画面

### プロンプト

```
Step 7: 評価済み一覧、全曲検索、曲詳細の3画面を実装します。

画面1: 評価済み一覧 /library

- タブで4分類: 得意 / 普通 / 苦手 / 練習中
- 各タブに件数バッジ(例: 「得意 (12)」)
- リスト項目:
  - ジャケ画像(小 64x64)
  - 曲名・アーティスト
  - 音域(カラオケ表記)
  - 評価更新日(相対表記、「3日前」など)
- 各項目をタップで詳細画面へ

実装メモ:
- 件数は get_user_rating_stats() で一括取得
- リストは evaluations を rating でフィルタ + songs を JOIN
- ソート: updated_at DESC

画面2: 全曲検索 /search

- 検索バー(曲名 or アーティスト名)
- 音域フィルタ(最高音のスライダー)
- 結果リスト(ジャケ + 曲名 + アーティスト + 音域)
- 未評価曲は「評価する」ボタン表示、評価済みは現在の評価バッジ表示

実装メモ:
- debounce 300ms での検索
- 大量結果対策: 先頭50件のみ表示、下部に「もっと見る」
- 検索クエリは title/artist に ILIKE

画面3: 曲詳細 /songs/[id]

- ジャケ画像(大 640x640)
- 曲名・アーティスト・リリース年
- 音域グラフ(後述)
- 評価(4択ボタン、現在の評価がハイライト)
- メモ入力欄(textarea、autosave)
- 戻るボタン

音域グラフ:
- 横軸: 半音ごとの位置(lowG 〜 hihiC 程度)
- 地声範囲を青バーで表示
- 裏声最高音を赤丸で表示
- ユーザーの推定音域(user_voice_estimate から)を緑の透過バーでオーバーレイ
- 推定値がまだない場合は緑バーを出さず、説明テキスト

実装メモ:
- グラフは SVG で手書きでOK(ライブラリ不要)
- メモの autosave は debounce 1秒

ナビゲーション:
- 画面下部に固定タブバー: ホーム / 一覧 / 検索 / プロフィール
- 現在画面のアイコンをハイライト

動作確認:
- 一覧で4分類がそれぞれ表示される
- 検索で曲名/アーティスト部分一致がヒット
- 詳細で評価変更・メモ編集が保存される
- 音域グラフに自分の推定値が重なって見える
```

### 完了基準

- [ ] `/library` で4タブが機能
- [ ] `/search` で検索と音域フィルタが動作
- [ ] `/songs/[id]` で詳細表示と評価変更
- [ ] メモの autosave が動く
- [ ] 音域グラフが表示される(推定値がなくても崩れない)

---

## Step 8: プロフィール画面

### プロンプト

```
Step 8: プロフィール画面 /profile を実装します。

表示内容:

1. ユーザー情報セクション
   - アバター画像(Google アカウントから)
   - 表示名
   - 登録日(auth.users.created_at)

2. 評価統計セクション
   - 総評価数
   - 4分類ごとの件数(円グラフ or 棒グラフ)
   - 「練習中」の曲は別途ハイライト(「練習中リスト」として見られるリンク)

3. 音域推定セクション
   - user_voice_estimate ビューから取得
   - 評価数 5 未満:「あと N曲評価すると音域が推定できます」
   - 評価数 5 以上 20 未満:「仮推定:{low} 〜 {high}(精度: 低)」
   - 評価数 20 以上:「推定音域:{low} 〜 {high}」
   - 快適な音域と限界音域を別々に表示
   - 音域表記はカラオケ表記 (mid2G など)

4. アクションボタン
   - ログアウト
   - データエクスポート(JSON ダウンロード、任意)

実装メモ:
- 円/棒グラフは SVG 手書き、もしくは軽量ライブラリ
- 評価統計は get_user_rating_stats() で取得
- 音域セクションの説明文で「easy評価をもっとつけると精度が上がります」とユーザーを誘導

動作確認:
- 新規ユーザー(評価0件)でエラーなく表示される
- 評価を重ねると推定値が変化することを確認
- ログアウトが動作
```

### 完了基準

- [ ] `/profile` が表示される
- [ ] 評価0件でもエラーにならない
- [ ] 評価数に応じて音域推定の表示が切り替わる
- [ ] ログアウトボタンが動作

---

## Step 9: デプロイ

### プロンプト

```
Step 9: Vercel へのデプロイとドメイン・環境変数の整備を行います。

作業:

1. Vercel プロジェクト作成
   - GitHub リポジトリ連携
   - フレームワーク検出: Next.js が自動認識
   - 環境変数を Vercel に登録(.env.local の内容)

2. Supabase 側の設定更新
   - Authentication > URL Configuration で本番URLを追加:
     - Site URL: https://your-app.vercel.app
     - Redirect URLs: https://your-app.vercel.app/auth/callback
   - Google OAuth の Authorized redirect URI にも追加

3. ビルド検証
   - ローカルで pnpm build が通ることを確認
   - 型エラー・Lintエラーを解消

4. 本番動作確認
   - Google ログイン → スワイプ評価 → 一覧 → プロフィールまで全通し
   - モバイル Safari での動作確認
   - ジャケ画像が表示される(Spotify 画像の next/image 許可リスト登録)

next.config.js に画像ドメイン追加:
- i.scdn.co (Spotify のCDN)

5. README.md の整備
   - セットアップ手順
   - 環境変数一覧
   - 開発コマンド
   - デプロイ手順
   - 既知の制限事項(音域データのカバレッジなど)

6. favicon と OGP 画像
   - 最小限のものを用意
   - title, description メタタグの設定

動作確認:
- 本番 URL で全機能が動く
- 新規ユーザーでの初回ログインがスムーズ
```

### 完了基準

- [ ] Vercel にデプロイ済み
- [ ] 本番 URL で Google ログインが動く
- [ ] モバイルで動作する
- [ ] README が整備されている

---

## 横断的な指針

### コミット戦略

各 Step ごとに 1 ブランチを切り、PR にまとめて merge:

```
main
 ├── feature/step-1-init
 ├── feature/step-2-supabase
 ├── feature/step-3-scraper
 └── ...
```

PR 単位で動作確認してから merge することで、巻き戻しが容易になる。

### テスト戦略

Step ごとに最低限のテストを入れる:

- Step 3: `note_converter.py` のユニットテスト
- Step 6: `midi.ts` のユニットテスト
- Step 6-7: 主要コンポーネントのスモークテスト(描画エラーが起きないか)

E2E テストは MVP スコープ外。

### 環境変数管理

本プロジェクトで扱う secret:
- Supabase: URL / anon key / service role key
- Spotify: Client ID / Secret
- Google OAuth: Client ID / Secret(Supabase 側で保持)

`.env.local` は絶対にコミットしない。`.env.local.example` で構造のみ共有する。

### エラーハンドリング方針

- ネットワークエラー: トースト表示 + リトライボタン
- 認証エラー: /login へリダイレクト
- 予期しないエラー: Sentry 等は MVP では省略、console.error に出力
- API レート制限: 指数バックオフ(自動リトライ)

### アクセシビリティ

- キーボード操作(Step 6 のショートカット)
- 十分なコントラスト
- aria-label の付与
- スクリーンリーダー対応は MVP では最低限

### パフォーマンス

- ジャケ画像は Next.js Image で遅延読み込み
- 楽曲一覧は仮想スクロール(件数が多い場合、Step 7 で考慮)
- 評価 upsert は楽観的 UI で体感速度を優先

---

## Claude Code 使用時の Tips

### 1ステップずつ進める

大きすぎる指示は出力品質が落ちる。Step 6 のような大きいステップは、さらに以下のように分割して依頼してもよい:

- Step 6-1: `midi.ts` と MIDI 変換テスト
- Step 6-2: `useUnratedSongs` フックのみ
- Step 6-3: `SongCard` コンポーネントのみ
- Step 6-4: `/home` ページで結合

### 動作確認を挟む

各ステップ完了時に、Claude Code に以下を依頼:

```
動作確認を以下の手順でやってください:
1. pnpm dev で起動
2. ブラウザで /xxx にアクセス
3. 結果を screenshot と共に報告

エラーが出たら修正してから報告してください。
```

### 仕様変更時の指示

途中で仕様変更したい場合は、設計書を先に更新してから Claude Code に反映を依頼する:

```
docs/karaoke_app_phase1_plan.md を更新しました。
{変更箇所}の部分を反映してコードを修正してください。
影響範囲を先に洗い出してから着手してください。
```

### エラー時の対処

Claude Code がハマったら、以下の順で対処:

1. エラーメッセージを全文読む(Claude Code にも読ませる)
2. 関連ドキュメント(docs/)を再度提示
3. シンプルな最小再現コードを作ってから戻る
4. それでも解けない時は、該当箇所を手動で書き換えてから続行指示

---

## 完了後のチェックリスト

全ステップ完了時に以下が満たされていれば、フェーズ1 完成。

### 機能面
- [ ] Google アカウントでログインできる
- [ ] 1000曲以上の楽曲マスタが表示される
- [ ] スワイプとボタンで評価できる
- [ ] 評価済み曲が4分類で閲覧できる
- [ ] 検索で曲が見つかる
- [ ] 曲詳細で音域グラフが表示される
- [ ] メモが保存される
- [ ] 音域推定が評価データから出る

### 品質面
- [ ] 本番 URL でアクセスできる
- [ ] モバイルで操作できる
- [ ] TypeScript 型エラー 0件
- [ ] ESLint エラー 0件
- [ ] 主要機能のユニットテストがある
- [ ] README が整備されている

### データ面
- [ ] songs テーブルに1000曲以上
- [ ] 各曲にジャケ画像URL
- [ ] 各曲に音域データ(欠損は許容)
- [ ] RLS が効いている(他ユーザーの評価が見えない)

---

## 次のフェーズへの布石

フェーズ1 完成時点で、以下のデータが自動的に溜まっていく:

- 自分の評価データ(フェーズ1.5 の推薦精度向上の基盤)
- 楽曲マスタ + Spotify track ID(フェーズ2 の Spotify 連携の基盤)
- 音域推定ロジック(フェーズ2 でも転用可能)

これらはフェーズ2 / 3 の前提条件になるので、フェーズ1 を使い続けること自体が次の開発の準備になる。

# カラオケ推薦アプリ フェーズ1 全体方針

## プロジェクト概要

Spotifyの視聴履歴を元にカラオケ楽曲を推薦するWebアプリ。最終的には友人のSpotifyデータも統合して、一緒にカラオケに行く際の選曲を支援する。

本ドキュメントは**フェーズ1(単純な記録機能)**の完成までの方針をまとめる。

---

## フェーズ構成

| フェーズ | 内容 | スコープ |
|---------|------|---------|
| **フェーズ1** | 単純な記録 | 楽曲マスタ・音域表示・評価記録(本ドキュメントの対象) |
| フェーズ1.5 | 遷移サジェスト | 「次歌う曲」の推薦。ベクトル空間上の近傍検索 |
| フェーズ2 | Spotify連携 | 個人のSpotify視聴履歴から自動プロファイル化 |
| フェーズ3 | 友人統合セッション | 複数人のデータを合成した推薦 |

フェーズ2から先はSpotify API・スクレイピング・LLMを組み合わせる大規模作業。フェーズ1は**評価データの蓄積そのものがフェーズ2以降の教師データ**となる設計。

---

## フェーズ1の最終スコープ

### 機能要件

1. **Google OAuth でログイン**
2. **有名曲200〜500曲の楽曲マスタ**(アプリ同梱)
   - 曲名、アーティスト、リリース年
   - 地声最低音・地声最高音・裏声最高音
   - ジャケット画像、Spotify track ID
3. **楽曲検索・一覧**(曲名・アーティスト・音域フィルタ)
4. **4択評価**(スワイプまたはボタン)
   - ❌ 苦手(hard)
   - △ 普通(medium)
   - ⭕ 得意(easy)
   - 🔖 練習中(practicing)
5. **評価済み一覧**(4タブで分類)
6. **曲詳細画面**(ジャケット・音域・評価・メモ編集)
7. **音域推定**(評価データから自動算出、プロフィール表示)

### 非スコープ(フェーズ2以降)

- Spotify連携、視聴履歴の自動取り込み
- 友人データの統合・セッション機能
- 楽曲推薦アルゴリズム
- キー変更履歴の記録(DBカラムだけ確保、UIは未実装)

---

## 技術スタック

| 領域 | 技術 |
|------|------|
| フロントエンド | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| スワイプ | framer-motion または react-tinder-card |
| バックエンド | Supabase (Auth / Postgres / RLS) |
| ホスティング | Vercel |
| データ収集 | Python / Node.js スクリプト(ローカル実行) |

WINC での `わせジュール` 開発と同系統のスタックなので学習コストは低い。

---

## データベース設計

### songs テーブル(楽曲マスタ)

```sql
CREATE TABLE songs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  artist          text NOT NULL,
  release_year    int,

  -- 音域(MIDI note number で正規化)
  range_low_midi      int,   -- 地声最低音
  range_high_midi     int,   -- 地声最高音
  falsetto_max_midi   int,   -- 裏声最高音(nullable)

  -- Spotify連携
  spotify_track_id    text UNIQUE,
  image_url_large     text,  -- 640x640
  image_url_medium    text,  -- 300x300
  image_url_small     text,  -- 64x64

  -- メタデータ
  source_urls         text[],  -- データ出典のURL(デバッグ用)
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_songs_title ON songs USING gin (to_tsvector('simple', title));
CREATE INDEX idx_songs_artist ON songs (artist);
CREATE INDEX idx_songs_range ON songs (range_high_midi);
```

### evaluations テーブル(ユーザー評価)

```sql
CREATE TYPE rating_type AS ENUM ('hard', 'medium', 'easy', 'practicing');

CREATE TABLE evaluations (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id     uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  rating      rating_type NOT NULL,
  memo        text,
  key_shift   int,          -- 将来用(キー調整値の記録)
  updated_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, song_id)
);

-- RLS: ユーザーは自分の評価しか読み書きできない
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own evaluations"
  ON evaluations FOR ALL
  USING (auth.uid() = user_id);
```

### user_voice_estimate ビュー(音域推定)

```sql
CREATE VIEW user_voice_estimate AS
SELECT
  e.user_id,
  COUNT(*) FILTER (WHERE e.rating IN ('easy', 'medium', 'hard')) AS rated_count,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s.range_high_midi)
    FILTER (WHERE e.rating = 'easy') AS comfortable_max_midi,
  MAX(s.range_high_midi) FILTER (WHERE e.rating = 'easy') AS limit_max_midi,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY s.range_low_midi)
    FILTER (WHERE e.rating = 'easy') AS comfortable_min_midi,
  MIN(s.range_low_midi) FILTER (WHERE e.rating = 'easy') AS limit_min_midi
FROM evaluations e
JOIN songs s ON s.id = e.song_id
WHERE e.rating != 'practicing'
GROUP BY e.user_id;
```

評価数が5件未満のユーザーは推定値を表示しない、といった制御はAPI層で行う。

---

## MIDI番号変換仕様

音域データをサイト間で統一して扱うため、カラオケ表記を整数(MIDI note number)に変換する。

| カラオケ表記 | 科学的ピッチ表記 | MIDI番号 |
|------|---------|---------|
| lowG | G2 | 43 |
| lowA | A2 | 45 |
| mid1C | C3 | 48 |
| mid1G | G3 | 55 |
| mid2C | C4 | 60 |
| mid2G | G4 | 67 |
| hiA  | A4 | 69 |
| hiC  | C5 | 72 |
| hiF  | F5 | 77 |
| hihiA | A5 | 81 |

基準: **hiA = A4 = MIDI 69**

表示時はMIDI番号 → カラオケ表記に逆変換。変換用の関数は TypeScript ライブラリとして実装しておく。

---

## データ収集計画

### 収集するデータ

有名曲200〜500曲について、以下をセットで揃える。

| 項目 | 出典候補 | 取得方法 |
|------|---------|---------|
| 有名曲リスト | DAM/JOYSOUND公式ランキング | スクレイピング |
| 音域(地声最低/最高・裏声最高) | カラ音 (karaoto.net) | スクレイピング(メイン) |
| 音域(補完) | カラオケ音域調査 (onikichosa.com) | スクレイピング(サブ) |
| Spotify track ID | Spotify Web API | `/v1/search` 呼び出し |
| ジャケット画像URL | Spotify Web API | search 結果に含まれる |

### 収集フロー

```
[1] カラオケランキング → 有名曲リスト(曲名・アーティスト)
        ↓
[2] Spotify Search API → track_id + 画像URL
        ↓
[3] 音域サイト検索 → 音域3値
        ↓
[4] マッチング検証 → 表記揺れをLLMで補正
        ↓
[5] JSON/CSV 出力 → Supabase に seed 投入
```

### スクレイピングのルール

- 各サイトの `robots.txt` と利用規約を事前確認
- User-Agent に連絡先を明示
- リクエスト間隔: **最低1秒**(サイトが混雑する時間帯は避ける)
- エラー時は指数バックオフでリトライ(最大3回)
- 全リクエストをログ化
- 取得データは**ローカルにキャッシュ**して、二度引きしない

### スクレイピングはClaude Codeで実装する

本作業はデータ永続性が必要なため、この環境(Claude.ai)ではなく**Hirotoさんのローカル環境でClaude Codeを使って実装**する。その際の仕様書は本ドキュメントが土台となる。

---

## 画面構成

### 画面一覧

| 画面 | 用途 |
|------|------|
| ログイン | Google OAuth |
| ホーム | 未評価曲のスワイプ評価(メイン体験) |
| 楽曲検索 | キーワード検索・音域フィルタ |
| 評価済み一覧 | 4タブ(得意/普通/苦手/練習中) |
| 曲詳細 | ジャケ・音域・評価編集・メモ |
| プロフィール | 推定音域・評価統計 |

### メイン画面(スワイプ評価)のワイヤーフレーム

```
┌─────────────────────────────┐
│  [≡]   カラオケ評価    [👤]  │
├─────────────────────────────┤
│                             │
│     ┌───────────────┐       │
│     │               │       │
│     │  ジャケ写真   │       │
│     │   (300x300)   │       │
│     │               │       │
│     └───────────────┘       │
│                             │
│     Lemon / 米津玄師         │
│     2018                    │
│                             │
│     地声 mid1F 〜 mid2G      │
│     裏声 hiC                │
│                             │
│  ┌────┬────┬────┬────┐     │
│  │ ❌ │ △ │ ⭕ │ 🔖 │     │
│  │苦手 │普通│得意│練習│     │
│  └────┴────┴────┴────┘     │
│                             │
│      (スワイプでも評価可)    │
└─────────────────────────────┘
```

---

## 実装順序

Claude Code への依頼を見越した実装順序。

### ステップ1: プロジェクト初期化(1〜2時間)
- Next.js プロジェクト作成
- Supabase プロジェクト作成、接続確認
- Tailwind + shadcn/ui セットアップ
- Google OAuth 設定

### ステップ2: DB構築(1時間)
- `songs` / `evaluations` テーブル作成
- RLS ポリシー設定
- `user_voice_estimate` ビュー作成
- 型定義の自動生成

### ステップ3: データ収集スクリプト(4〜8時間)
- スクレイパ実装(カラ音 / onikichosa)
- Spotify API 呼び出し
- 表記揺れマッチング
- 出力 → `songs` テーブルに seed 投入

### ステップ4: UI実装(4〜6時間)
- ログイン画面
- スワイプ評価画面(メイン)
- 楽曲検索・一覧
- 曲詳細
- プロフィール(推定音域表示)

### ステップ5: デプロイと動作確認(1〜2時間)
- Vercel デプロイ
- OAuth リダイレクトURI 設定
- 本番環境動作確認

**合計見積: 11〜19時間**(週末2〜3日で完成ライン)

---

## 成功の定義

フェーズ1完了時に、Hirotoさん本人が以下を実現できている状態:

1. アプリにログインし、200曲以上の有名曲から自分の評価を記録できる
2. 楽曲詳細で、地声/裏声の音域が一目で分かる
3. 「得意」「練習中」で分類された自分のリストを閲覧できる
4. カラオケ当日に自分の十八番リストをスマホで見返せる
5. 評価データが蓄積され、フェーズ1.5以降の推薦機能の基盤となる

---

## リスクと対策

| リスク | 対策 |
|-------|------|
| スクレイピング先の規約違反 | robots.txt 事前確認、リクエスト間隔1秒以上、連絡先明示 |
| 楽曲マッチングの表記揺れ | LLMベースの補正、手動検証ステップを設ける |
| 音域データのカバレッジ不足 | MVP は 200曲に絞り、カバー率8割を目指す |
| Spotify API レート制限 | バッチ処理時に sleep を挟む |
| 評価UIの継続性 | スワイプ式でゲーム化、練習中リストで目的意識 |

---

## 次のアクション

本ドキュメントを元に、以下のいずれかに進む:

**A. データ収集の実装準備**
対象サイトのHTML構造を確認 → スクレイパの詳細設計書を作成 → Claude Codeに渡す

**B. UI設計の詳細化**
スワイプ画面の具体的な挙動・アニメーション・状態遷移を設計 → ワイヤーフレームの最終版作成

**C. Claude Code への依頼書作成**
ステップ1〜5をそれぞれ Claude Code 向けプロンプトに分解

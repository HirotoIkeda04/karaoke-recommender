# DBマイグレーション解説

カラオケ推薦アプリ フェーズ1 の Supabase DB スキーマ。
`001_initial_schema.sql` の設計意図と運用注意点をまとめる。

---

## テーブル構成

### songs(楽曲マスタ)

全ユーザー共通のマスタデータ。スクレイパで取得した有名曲が入る。

| カラム | 型 | 意味 |
|-------|---|------|
| id | uuid | 主キー |
| title | text | 曲名 |
| artist | text | アーティスト名 |
| release_year | int | リリース年 |
| range_low_midi | int | 地声最低音(MIDI) |
| range_high_midi | int | 地声最高音(MIDI) |
| falsetto_max_midi | int | 裏声最高音(MIDI)、なければ NULL |
| spotify_track_id | text | Spotify の track ID(ユニーク) |
| image_url_large/medium/small | text | ジャケット画像 URL |
| is_popular | boolean | 代表曲フラグ(カラ音の太字) |
| source_urls | text[] | データ出典(デバッグ用) |
| created_at, updated_at | timestamptz | タイムスタンプ |

**設計判断**

- **音域を MIDI 番号で持つ**: サイト間の表記揺れを吸収でき、数値比較で音域判定が可能。UI 表示時に逆変換する
- **is_popular フラグ**: 有名曲絞り込み用。当面はカラ音の太字を採用
- **Spotify track ID は UNIQUE**: 同一曲の重複登録を防ぐ

**制約**

- `range_low_midi <= range_high_midi`(最低 ≤ 最高)
- MIDI は 0〜127 の範囲内

### evaluations(ユーザー評価)

ユーザーごとの評価データ。1ユーザー × 1曲で1行。

| カラム | 型 | 意味 |
|-------|---|------|
| user_id | uuid | ユーザー ID(FK to auth.users) |
| song_id | uuid | 曲 ID(FK to songs) |
| rating | enum | hard / medium / easy / practicing |
| memo | text | 自由メモ |
| key_shift | int | キー調整値(将来用、-12〜+12) |
| created_at, updated_at | timestamptz | タイムスタンプ |

主キー: `(user_id, song_id)` の複合。同じユーザーが同じ曲を複数評価することはできない(評価を変えたい時は UPDATE)。

**設計判断**

- **rating を ENUM**: 4状態のみなので ENUM で型安全にする
- **key_shift カラムを先に確保**: フェーズ1では未使用だが、後からマイグレーション不要で使える
- **ON DELETE CASCADE**: ユーザーが退会したら評価も消える / 曲がマスタから消えたら評価も消える

---

## ビュー: user_voice_estimate

評価データから音域を統計的に推定する。

**推定ロジック**
- 快適な上限 = easy評価の曲の最高音の75パーセンタイル
- 限界の上限 = easy評価の曲の最高音の最大値
- 下限も同様(25パーセンタイル / 最小値)

**利用時の注意**
- 評価数が少ない(特に easy が 5曲未満)ときは推定が不安定
- API 層で `easy_count < 5` なら推定値を返さない、といった制御を実装する

**security_invoker = on**
通常のビューは作成者の権限で実行されて RLS を無視してしまう。この設定により、**ビューを呼び出したユーザーの権限で**評価テーブルを参照するようになり、結果として**自分のデータしか見えない**ようになる。

---

## RLS (Row Level Security) 設計

### songs: 全員閲覧可、書き込み不可

- `SELECT` ポリシー: `using (true)` → 誰でも見られる
- `INSERT/UPDATE/DELETE` ポリシーは作成しない
  - authenticated / anon ロールでは書き込めない
  - seed 投入は **service_role key で実施**(RLS バイパス)

### evaluations: 自分のデータのみ操作可

- すべての操作で `auth.uid() = user_id` を強制
- 他のユーザーの評価は**見えもしない**

**これが効く理由**

Supabase のクライアントライブラリは、ログインユーザーの JWT を自動で付与する。PostgreSQL 側で `auth.uid()` がそのユーザーの ID に解決され、ポリシーが自動適用される。アプリコード側でユーザー ID を手動で指定する必要がなく、**SQL インジェクション等でユーザー ID を偽装するリスクが原理的にない**。

---

## ヘルパ関数

### get_unrated_songs(p_limit, p_popular_only)

スワイプ画面で使う。ログインユーザーがまだ評価していない曲をランダムに返す。

```sql
-- 未評価曲を20曲取得
select * from get_unrated_songs();

-- 代表曲のみ50曲取得
select * from get_unrated_songs(50, true);
```

**設計上のポイント**
- `security invoker` で呼び出し元の権限で実行 → `auth.uid()` が機能
- `order by random()` は数千行程度なら十分高速
- Next.js からは `supabase.rpc('get_unrated_songs', {...})` で呼べる

### get_user_rating_stats()

プロフィール画面で使う。各評価の件数を返す。

```sql
select * from get_user_rating_stats();
-- rating    | count
-- ----------+-------
-- easy      | 45
-- medium    | 23
-- hard      | 12
-- practicing|  8
```

---

## 投入手順

### 1. Supabase プロジェクト作成
- Dashboard で新規プロジェクト作成
- プロジェクト URL と anon key / service role key を `.env.local` にメモ

### 2. スキーマ適用

**方法 A: Dashboard から**
- SQL Editor に `001_initial_schema.sql` の内容を全文貼り付けて実行

**方法 B: Supabase CLI から**
```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

### 3. Google OAuth 設定
- Dashboard > Authentication > Providers > Google を有効化
- Google Cloud Console で OAuth クライアント作成
- Client ID / Secret を Supabase に登録
- Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`

### 4. 楽曲マスタ seed 投入

service_role key を使って投入(RLS バイパス)。

```bash
# 例: Node.js スクリプト
npx ts-node scripts/seed_songs.ts
```

スクリプトは `songs_seed.json` を読み込み、`supabase.from('songs').upsert(...)` で書き込む。

### 5. 動作確認クエリ

```sql
-- 曲数確認
select count(*) from songs;

-- 代表曲のサンプル
select title, artist, range_high_midi
from songs
where is_popular
limit 10;

-- 自分の評価(ログイン後)
select s.title, e.rating
from evaluations e
join songs s on s.id = e.song_id
order by e.updated_at desc;
```

---

## TypeScript 型生成

Supabase CLI で DB スキーマから TypeScript 型を自動生成できる。

```bash
supabase gen types typescript --project-id <id> > src/types/database.ts
```

出力例:
```typescript
export interface Database {
  public: {
    Tables: {
      songs: {
        Row: { id: string; title: string; ... }
        Insert: { id?: string; title: string; ... }
        Update: { id?: string; title?: string; ... }
      }
      evaluations: { ... }
    }
    Enums: {
      rating_type: 'hard' | 'medium' | 'easy' | 'practicing'
    }
  }
}
```

これをアプリ側で使うと、DB スキーマ変更時にコンパイルエラーで検知できる。

---

## よくある使用パターン(Next.js 側)

### 未評価曲を取得

```typescript
const { data: songs } = await supabase
  .rpc('get_unrated_songs', { p_limit: 20 });
```

### 評価を upsert(新規 or 更新を兼ねる)

```typescript
await supabase.from('evaluations').upsert({
  user_id: user.id,
  song_id: songId,
  rating: 'easy',
});
// 主キーが (user_id, song_id) なので、既存評価があれば上書き
```

### 評価済み曲を rating でフィルタ

```typescript
const { data } = await supabase
  .from('evaluations')
  .select('rating, memo, songs(*)')
  .eq('rating', 'easy')
  .order('updated_at', { ascending: false });
```

RLS により、自分の評価しか返らない。

### 音域推定の取得

```typescript
const { data: estimate } = await supabase
  .from('user_voice_estimate')
  .select('*')
  .single();

if (!estimate || estimate.easy_count < 5) {
  // 推定不能、UIで「もう少し評価してください」表示
}
```

---

## 将来の拡張ポイント(フェーズ2以降)

このスキーマは以下の拡張を想定済み:

- **フェーズ1.5(遷移サジェスト)**: `songs` に `embedding vector(1536)` を追加(pgvector 拡張が必要)
- **フェーズ2(Spotify 連携)**: `user_spotify_profiles` テーブル追加、`songs.spotify_track_id` と JOIN
- **フェーズ3(セッション)**: `sessions`, `session_members`, `session_tracks` の3テーブル追加

今回のスキーマはどの拡張にも対応できる設計になっている。

---

## チェックリスト

マイグレーション適用後、以下を確認:

- [ ] `songs` テーブルが作成された
- [ ] `evaluations` テーブルが作成された
- [ ] `user_voice_estimate` ビューが作成された
- [ ] `rating_type` ENUM が登録された
- [ ] `songs` に RLS が有効化されている(SELECT のみ)
- [ ] `evaluations` に RLS が有効化されている(全操作で user_id チェック)
- [ ] `get_unrated_songs`, `get_user_rating_stats` 関数が作成された
- [ ] 認証後に `get_unrated_songs()` が動作する
- [ ] ログアウト状態で `songs` が SELECT できる
- [ ] ログアウト状態で `evaluations` に INSERT できないことを確認

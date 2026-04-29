# Supabase / PostgreSQL ハマりどころ

評価タブの推薦ロジック調整 (Migrations 015〜024) の過程で実際に遭遇した
ハマりどころと、その回避策をまとめる。同じ罠を 2 度と踏まないために残す。

---

## 1. RLS 有効 + SELECT ポリシー無し = 全行ブロック

### 症状
- `GRANT SELECT ON table TO authenticated` 実行済みなのに、authenticated ユーザーが
  そのテーブルから 1 行も読めない
- SQL Editor (postgres ロール) からは普通に読める ので開発時に気付きにくい

### 原因
Supabase は RLS が有効なテーブルに対して、ポリシーが無い場合は **全行を拒否** する仕様。
GRANT は「テーブルへのアクセス権」、RLS ポリシーは「行の可視性」と独立した二層構造。

### 確認方法

```sql
-- RLS 有効か
SELECT relname, relrowsecurity FROM pg_class
WHERE relname IN ('songs', 'evaluations', 'artists');

-- ポリシー一覧
SELECT tablename, policyname, cmd, roles, qual::text
FROM pg_policies WHERE tablename = 'songs';
```

### 解決
全行 SELECT 可にしたいテーブル：

```sql
ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS songs_select_authenticated ON public.songs;
CREATE POLICY songs_select_authenticated
  ON public.songs FOR SELECT
  TO authenticated
  USING (true);
```

自分の行だけ SELECT 可：

```sql
CREATE POLICY evaluations_select_own ON public.evaluations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
```

### 教訓
**新規テーブル作成時は、GRANT と同時に RLS ポリシーも必ず追加** する。
忘れると本番で「app からだけ何も見えない」現象が起きる。

---

## 2. `least(NULL, X)` は NULL を無視して X を返す

### 症状
LEFT JOIN 結果が NULL の場合に「ない時はデフォルト値」を返したくて
`least(1.0 + 0.5 * uap.cnt, 5.0)` のような式を書くと、`uap.cnt = NULL` の時に
`1.0 + 0.5 * NULL = NULL`、それを `least(NULL, 5.0)` した結果が **5.0** になる。

期待と逆: 「データなし → デフォルト 1.0」のつもりが「データなし → 5.0 (上限値)」になる。

### 原因
PostgreSQL の `least()` / `greatest()` は **NULL 引数を無視する**。
全引数が NULL の時のみ NULL を返す。

### 解決
`COALESCE` で先に NULL を弾くか、明示的 CASE：

```sql
-- ❌ NG
coalesce(least(1.0 + 0.5 * uap.cnt, 5.0), 1.0)

-- ✅ OK
case
  when uap.cnt is null then 1.0
  else least(1.0 + 0.5 * uap.cnt, 5.0)
end
```

### 教訓
**算術演算と LEFT JOIN の組み合わせで `least` / `greatest` を使う時は要警戒**。
NULL の伝播ルールを意識する。`COALESCE(least(x, y), default)` パターンは罠。

---

## 3. `CREATE OR REPLACE FUNCTION` でも PostgREST のキャッシュは残ることがある

### 症状
- 関数を `CREATE OR REPLACE` で更新
- SQL Editor から呼ぶと新しい結果
- アプリ (PostgREST RPC) から呼ぶと **古い動作のまま**
- `NOTIFY pgrst, 'reload schema'` を打っても効かない

### 原因
PostgREST は接続プール内で関数のプランをキャッシュする。
`CREATE OR REPLACE` は同名なのでキャッシュが無効化されない場合がある。
特に複雑な CTE を多用した関数で起きやすい。

### 解決
**関数名を変えて作り直す** のが確実：

```sql
DROP FUNCTION IF EXISTS public.get_unrated_songs_v2(int, boolean);
CREATE OR REPLACE FUNCTION public.get_unrated_songs_v2(...) ...;
NOTIFY pgrst, 'reload schema';
```

そしてアプリ側 (`supabase.rpc("get_unrated_songs_v2", ...)`) でも名前を更新。

### 教訓
- 関数の挙動を大きく変える時は、別名にして deploy 全体で切替えるのが安全
- 旧関数は当面残しておけば、問題があれば 1 行で戻せる
- 軽微な修正なら CREATE OR REPLACE で良い

---

## 4. `set_config('request.jwt.claim.sub')` は `auth.uid()` を変えるが role は変えない

### 症状
SQL Editor で `set_config('request.jwt.claim.sub', user_id, true)` してから
`select * from get_unrated_songs_v2(...)` すると、`auth.uid()` は user_id を返す。
でもロールは依然 `postgres` のまま → RLS バイパスされる。

結果として：
- SQL Editor の動作確認: 全部正しく動く
- 実 app 経由: RLS が効いて 0 件返す

ロールの違いに気付かないと「DB は正しいのに app だけ壊れてる」謎現象になる。

### 解決
SQL Editor で authenticated ロールを完全シミュレートしたい場合：

```sql
-- 注: BEGIN; ... ROLLBACK; で囲む。Supabase SQL Editor では自動でトランザクション
-- なので SET LOCAL は使える
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub TO '<user_id>';
SET LOCAL request.jwt.claim.role TO 'authenticated';

SELECT * FROM get_unrated_songs_v2(20, true);
```

### 教訓
**「SQL Editor で動く = アプリで動く」ではない**。RLS が絡む時は role 切替も含めて検証する。

---

## 5. swipe-deck の queue は React state、初回ロード分しか保持しない

### 症状
推薦ロジック変更後、アプリで「演歌が消えない」と感じる。
実は単に **既にロード済みの 20 曲を消費中** なだけで、新しい deck は新しいロジックが適用される。

### 原因
[src/app/(app)/swipe-deck.tsx](../src/app/(app)/swipe-deck.tsx) の queue は
`useState(initialSongs)` で local state として保持。スワイプで切替えても
**自動 refetch しない**。20 曲使い切ったら「再読込してください」メッセージ。

### 解決
動作確認時はタブ切替 (e.g., ライブラリ → 評価) で page を再ロードする。
将来は queue 末尾近くで自動 fetch する改善が望ましい。

---

## 6. デバッグ時の鉄則

PostgREST 経由と SQL Editor 直接呼出しで挙動が違う時の切り分け順：

1. **関数定義の確認**: `pg_get_functiondef('func(args)'::regprocedure)` で実装を直接見る
2. **GRANT 確認**: `information_schema.table_privileges` で authenticated に SELECT があるか
3. **RLS 状態**: `pg_class.relrowsecurity` で有効か
4. **ポリシー確認**: `pg_policies` で SELECT ポリシーが authenticated に存在するか
5. **NULL の挙動**: 算術や `least`/`greatest` で NULL 伝播を疑う
6. **キャッシュ疑惑**: 関数名を変えて完全切替で試す
7. **クライアントキャッシュ**: PC のシークレットモードで再現するか

---

## 関連 Migration

| # | 内容 | 教訓 |
|---|---|---|
| 014 | user_genre_distribution view + ジャンル重み付け | view も RLS 影響を受ける |
| 016 | sqrt + genre² + artist_boost | NULL 伝播バグ混入 |
| 020 | 関数 DROP + 再 CREATE | CREATE OR REPLACE の限界 |
| 021 | 関数名を `_v2` に変更 | キャッシュ確実バイパス |
| 022 | シンプルロジックでデバッグ | 切り分けの基本姿勢 |
| 023 | RLS ポリシー追加 (真犯人) | GRANT と RLS は別物 |
| 024 | 重み付け復活 + NULL バグ修正 | 教訓を反映した最終版 |

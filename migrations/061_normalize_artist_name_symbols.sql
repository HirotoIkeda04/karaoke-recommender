-- ============================================================================
-- 061: normalize_artist_name の記号クラス拡張 + name_norm 全件再計算
-- ----------------------------------------------------------------------------
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011 / 033 / 060 実行済み
-- 前提(重要): scripts/merge-dup-artists-3.ts を先に適用して、
--             name_search 衝突 7 組の重複アーティストを統合しておくこと。
--             未統合のまま流すと下の DO ブロックが exception で止まる。
--
-- ----------------------------------------------------------------------------
-- 背景
-- ----------------------------------------------------------------------------
-- 060 で入れた artists.name_search (カナ折り畳み済みの検索キー) でグルーピング
-- したところ、「区切り文字違いだけ」の重複アーティストが 7 組見つかった。
--
--   藤山一郎･奈良光枝    / 藤山一郎/奈良光枝
--   五木ひろし･木の実ナナ / 五木ひろし/木の実ナナ
--   石原裕次郎･牧村旬子   / 石原裕次郎/牧村旬子
--   里見浩太朗・横内正    / 里見浩太朗/横内正
--   浜圭介･桂銀淑        / 浜圭介/桂銀淑
--   藤谷美和子・大内義昭  / 藤谷美和子/大内義昭
--   L'Arc-en-Ciel        / L'Arc～en～Ciel
--
-- name_norm は UNIQUE なので、本来これらは INSERT 時点で弾かれるはずだった。
-- 実際の name_norm を見ると原因がわかる:
--
--   name = '藤山一郎/奈良光枝'  →  name_norm = '藤山一郎/奈良光枝'   (/ が残っている)
--   name = "L'Arc～en～Ciel"    →  name_norm = "l'arc～en～ciel"     (' も ～ も残っている)
--
-- つまり **name_norm が normalize_artist_name の結果になっていない**。
-- 033 が除去するはずの / や ' が残っているので、これらの行は SQL 関数ではなく
-- スクリプト側の独自 normalize (NFKC + lower + 空白除去だけ、033 以前の規則) で
-- 書かれたものである。該当は seed-from-dam-ranking / seed-from-joysound-ranking /
-- fetch-weekly-rankings / import-artist-songs / import-wanted-songs の 5 本で、
-- いずれも「曖昧マッチ用の緩いキー」をそのまま name_norm に流用していた。
-- 実データでは 1874 行中 237 行の name_norm が normalize_artist_name の結果と
-- 一致していない。
--
-- したがって主因は SQL の記号クラスではなく TS 側の不一致。ただし 1 組
-- (L'Arc-en-Ciel) だけは記号クラス側にも穴があり、両方を塞ぐ必要がある。
--
--   ･ (U+FF65) → NFKC で ・ (U+30FB) になるので 033 でも既にカバー済み
--   ～ (U+FF5E) → NFKC で ~ (U+007E) になるが、~ は記号クラスに無い
--   〜 (U+301C) → NFKC で畳まれない。同じく記号クラスに無い
--
-- ----------------------------------------------------------------------------
-- 本マイグレーションでやること
-- ----------------------------------------------------------------------------
--   1. normalize_artist_name の記号クラスに ･ / ~ / 〜 を追加
--   2. name_norm が UNIQUE 衝突しないことを事前検証 (衝突したら abort)
--   3. artists.name_norm を全件再計算し、関数の出力と一致させる
--
-- ----------------------------------------------------------------------------
-- : と [ ] は「追加しない」判断
-- ----------------------------------------------------------------------------
-- 当初 : [ ] も候補に挙がったが、全 1874 行で検証した結果 **1 組も重複を
-- 解消しない** 一方で、これらは実際のアーティスト名で意味を持っている。
--
--   BE:FIRST / ME:I / Re:Japan / CLASS:y
--   [Alexandros] / SawanoHiroyuki[nZk]:TOMORROW X TOGETHER
--   ヒプノシスマイク[どついたれ本舗] / After the Rain [そらる×まふまふ]
--
-- 除去すると ME:I → 'mei'、CLASS:y → 'classy' となり、将来 "Mei" や "Classy"
-- という別アーティストが来たときに UNIQUE で誤統合される。得るものが無く
-- 誤マージのリスクだけが増えるので、今回は見送る。
--
-- ----------------------------------------------------------------------------
-- 再発防止 (SQL 側だけでは閉じない)
-- ----------------------------------------------------------------------------
-- TS 側の name_norm 計算を scripts/lib/normalize-artist-name.ts に一本化し、
-- 上記 5 スクリプトの INSERT がそれを使うように変更済み。
-- 逸脱の検出は `pnpm check:strict-normalize` で行う。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 記号クラスの拡張
-- ----------------------------------------------------------------------------
-- 033 からの差分は文字クラスに ･ ~ 〜 を足しただけ。
-- ･ は NFKC で ・ になるため冗長だが、NFKC を通していない呼び出しに備えて明示する。
create or replace function public.normalize_artist_name(name text) returns text as $$
  select regexp_replace(
    lower(normalize(name, NFKC)),
    '[[:space:].\-_,!?''"・･/\\()（）「」『』【】~〜]+',
    '',
    'g'
  )
$$ language sql immutable;


-- ----------------------------------------------------------------------------
-- 2. 衝突の事前検証
-- ----------------------------------------------------------------------------
-- name_norm は UNIQUE なので、再計算で 2 行以上が同じキーに落ちると
-- UPDATE が制約違反で落ちる。エラーメッセージが「どの行か」を教えてくれない
-- ため、先に自前で検出して読める形で落とす。
--
-- 適用前チェックは scripts/check-strict-normalize.ts でも同じ内容を確認できる。
do $$
declare
  v_dupes text;
begin
  select string_agg(detail, e'\n')
  into v_dupes
  from (
    select
      public.normalize_artist_name(name) as key,
      '  [' || public.normalize_artist_name(name) || '] '
        || string_agg(name || ' (' || id || ')', ' / ' order by name) as detail
    from public.artists
    where public.normalize_artist_name(name) <> ''
    group by public.normalize_artist_name(name)
    having count(*) > 1
  ) d;

  if v_dupes is not null then
    raise exception
      E'name_norm の再計算で UNIQUE 衝突が起きます。先に重複アーティストを統合してください:\n%',
      v_dupes;
  end if;
end;
$$;


-- ----------------------------------------------------------------------------
-- 3. name_norm 全件再計算
-- ----------------------------------------------------------------------------
-- 033 のバックフィル以降にスクリプト経由で入った行 (実測 237 行) は
-- name_norm が関数の出力と食い違っている。ここで揃える。
update public.artists
set name_norm = public.normalize_artist_name(name)
where name_norm is distinct from public.normalize_artist_name(name);


-- ----------------------------------------------------------------------------
-- 4. 生成列 name_search / *_search の整合確認
-- ----------------------------------------------------------------------------
-- 060 の *_search は normalize_artist_name を内部で呼ぶ生成列だが、PostgreSQL は
-- 関数を差し替えても格納済みの生成列を再計算しない。
--
-- 今回の差分に限れば影響は無いはず:
--   ･ → NFKC で ・ になり 033 時点で既に除去されていた
--   ~ / 〜 → normalize_search_key 側が '[ー〜~]+' で別途落としていた
-- ただし「はず」で済ませないよう、ズレが残っていれば NOTICE を出す。
--
-- 0 以外が出た場合は生成列の作り直しが必要:
--   drop view public.artists_with_song_count;
--   alter table public.artists drop column name_search;
--   -- そのうえで 060 の該当ブロック (列追加・index・view) を再実行する
do $$
declare
  v_artists int;
  v_songs   int;
begin
  select count(*) into v_artists
  from public.artists
  where name_search is distinct from public.normalize_search_key(name);

  select count(*) into v_songs
  from public.songs
  where title_search is distinct from public.normalize_search_key(title)
     or artist_search is distinct from public.normalize_search_key(artist);

  raise notice
    'generated search key drift: artists=% songs=% (どちらも 0 なら再作成不要)',
    v_artists, v_songs;
end;
$$;


notify pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

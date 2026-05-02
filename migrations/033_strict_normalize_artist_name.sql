-- ============================================================================
-- normalize_artist_name の厳格化 + 既存 artists.name_norm の再計算
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 背景:
--   011_artists_and_genres.sql の normalize_artist_name は
--   「空白を 1 つに圧縮するだけ」だったため、以下のような表記ゆれを
--   吸収できず重複アーティストが発生していた。
--     - "Mrs. GREEN APPLE" / "Mrs.GREEN APPLE"   (空白の有無)
--     - "秦基博" / "秦 基博"                      (全角空白)
--     - "嵐" / "嵐(アラシ)"                       (括弧つき別表記)
--
--   本マイグレーションでは
--     1. normalize から空白・ドット・主要記号・括弧類を完全除去するように変更。
--     2. 既存 artists.name_norm を新ルールで再計算。
--
--   再計算前に scripts/check-strict-normalize.ts で衝突 0 件であることを確認済み。
-- ============================================================================

create or replace function public.normalize_artist_name(name text) returns text as $$
  select regexp_replace(
    lower(normalize(name, NFKC)),
    '[[:space:].\-_,!?''"・/\\()（）「」『』【】]+',
    '',
    'g'
  )
$$ language sql immutable;

update public.artists
set name_norm = public.normalize_artist_name(name)
where name_norm is distinct from public.normalize_artist_name(name);

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

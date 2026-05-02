-- ============================================================================
-- songs.duration_ms カラム追加
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 背景:
--   楽曲詳細ページで曲の長さを表示できるようにするため、Spotify API の
--   duration_ms (ミリ秒) を保持するカラムを追加する。
--
--   既存レコードは NULL のまま (バックフィルしない)。今後 scraper が
--   集めるデータには duration_ms が含まれるため、新規曲から順次埋まる。
-- ============================================================================

alter table public.songs
  add column if not exists duration_ms integer;

comment on column public.songs.duration_ms is
  'Spotify API の duration_ms。曲の長さ (ミリ秒)。表示時は m:ss に整形する。';

-- ============================================================================
-- songs に Spotify 由来の追加フィールドを格納するカラムを追加
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 背景:
--   既存の Spotify 取り込みでは id / 画像 / release_date / duration_ms しか
--   保存していなかったが、以下の 4 フィールドはカラオケ推薦アプリの UX や
--   推薦精度に有用なため取り込むようにする。
--
--   - popularity   : 0-100 の人気度。fame_score(Wikipedia 由来) を補完
--   - preview_url  : 30 秒試聴 mp3 URL。アプリ内プレビュー再生に使う
--   - explicit     : 露骨な歌詞かのフラグ。フィルタ用
--   - isrc         : 国際標準レコーディングコード。他サービスとのマッチング用
--
--   既存レコードは NULL のまま (バックフィルしない)。今後 scraper が
--   集めるデータには 4 フィールドが含まれるため、新規曲から順次埋まる。
-- ============================================================================

alter table public.songs
  add column if not exists spotify_popularity smallint,
  add column if not exists spotify_preview_url text,
  add column if not exists spotify_explicit boolean,
  add column if not exists spotify_isrc text;

comment on column public.songs.spotify_popularity is
  'Spotify API の popularity (0-100)。fame_score とは別軸の人気指標';
comment on column public.songs.spotify_preview_url is
  'Spotify API の preview_url。30 秒試聴 mp3。アプリ内インライン再生用';
comment on column public.songs.spotify_explicit is
  'Spotify API の explicit。露骨な歌詞フラグ';
comment on column public.songs.spotify_isrc is
  'Spotify API の external_ids.isrc。他サービス (DAM 等) とのマッチング用';

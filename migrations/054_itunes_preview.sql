-- ============================================================================
-- iTunes プレビュー再生: songs にプレビュー URL カラムを追加
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 053 まで実行済み
--
-- 背景:
--   ホームのレコードデッキで各曲の頭 6 秒を試聴できるようにする。
--   Spotify の spotify_preview_url は 2026-02 の API 変更で Dev Mode アプリ
--   への提供が止まり新規取得不可のため、iTunes Search API (無料・無認証、
--   previewUrl = 30 秒 AAC) を音源ソースにする。
--
-- カラム:
--   itunes_preview_url        30 秒プレビューの音源 URL (*.mzstatic.com)
--   itunes_track_id           マッチした iTunes trackId (デバッグ/再取得用)
--   itunes_preview_checked_at バックフィルの試行日時。マッチ失敗でも記録し、
--                             再実行時に同じ曲を何度も検索しないようにする
--
-- 投入は scripts/backfill-itunes-previews.ts (service_role) が行う。
-- 読み取りは既存の songs SELECT ポリシーのまま (authenticated)。
-- ============================================================================

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS itunes_preview_url text,
  ADD COLUMN IF NOT EXISTS itunes_track_id bigint,
  ADD COLUMN IF NOT EXISTS itunes_preview_checked_at timestamptz;

COMMENT ON COLUMN public.songs.itunes_preview_url IS
  'iTunes Search API の previewUrl (30 秒 AAC)。ホームの試聴再生に使用';
COMMENT ON COLUMN public.songs.itunes_track_id IS
  'マッチした iTunes trackId';
COMMENT ON COLUMN public.songs.itunes_preview_checked_at IS
  'プレビュー取得を試行した日時 (失敗含む)。NULL = 未試行';

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

-- ============================================================================
-- song_logs.score: 採点結果 (DAM/JOYSOUND の精密採点など)
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 用途:
--   歌った記録に採点結果を残せるようにする。
--   DAM 精密採点・JOYSOUND 分析採点ともに 0.001 刻みなので numeric(6,3)。
--   100.000 まで入りうる (実機では 100.000 が出ることもある)。
-- ============================================================================

ALTER TABLE public.song_logs
  ADD COLUMN IF NOT EXISTS score numeric(6,3);

ALTER TABLE public.song_logs
  DROP CONSTRAINT IF EXISTS song_logs_score_valid;

ALTER TABLE public.song_logs
  ADD CONSTRAINT song_logs_score_valid
    CHECK (score IS NULL OR (score >= 0 AND score <= 100));

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

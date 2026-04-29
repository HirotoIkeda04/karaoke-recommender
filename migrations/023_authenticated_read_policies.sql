-- ============================================================================
-- songs / artists / evaluations の認証ユーザー読み取りポリシー
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 022 まで実行済み
--
-- 背景:
--   GRANT SELECT は付与済みだが、RLS 有効 + SELECT ポリシー無しの場合、
--   authenticated ロールは行が見えなくなる (Supabase の典型的な落とし穴)。
--   関数 get_unrated_songs_v2 が app から呼ばれると 0 件返す原因。
--
--   SQL Editor は postgres 権限なので RLS バイパス → 正しく動作するように見える。
--
-- 対策:
--   1. songs / artists: 認証ユーザーは全件 SELECT 可能 (read all)
--   2. evaluations: 自分の行のみ SELECT 可能 (既存の場合は維持)
--
--   IF NOT EXISTS でポリシーが既存の場合はスキップ。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- songs: 全行 SELECT 可
-- ----------------------------------------------------------------------------

ALTER TABLE public.songs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS songs_select_authenticated ON public.songs;
CREATE POLICY songs_select_authenticated
  ON public.songs FOR SELECT
  TO authenticated
  USING (true);


-- ----------------------------------------------------------------------------
-- artists: 全行 SELECT 可
-- ----------------------------------------------------------------------------

ALTER TABLE public.artists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS artists_select_authenticated ON public.artists;
CREATE POLICY artists_select_authenticated
  ON public.artists FOR SELECT
  TO authenticated
  USING (true);


-- ----------------------------------------------------------------------------
-- evaluations: 自分の行のみ SELECT 可
-- ----------------------------------------------------------------------------

ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evaluations_select_own ON public.evaluations;
CREATE POLICY evaluations_select_own
  ON public.evaluations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());


-- スキーマ再読込通知
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

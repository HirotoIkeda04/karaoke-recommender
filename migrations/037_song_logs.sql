-- ============================================================================
-- song_logs テーブル: 楽曲ごとの「歌った記録」(日記/つぶやき形式)
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 用途:
--   evaluations.memo は 1 楽曲につき 1 件だけの「永続メモ」だったが、
--   同じ曲を繰り返し歌う中で得る気づき (機材/キー調整/感想) を時系列で
--   残せるようにする。
--
-- 設計:
--   - (user_id, song_id) は多対多ではなく 1 楽曲に複数ログを許可する
--     ため UNIQUE 制約は付けない。
--   - logged_at は date 型 (時刻まで持つ必要は今のところない)。
--   - equipment は DAM / JOYSOUND の 2 択 + null (= 指定なし) を想定。
--     enum ではなく text + CHECK 制約にしておくと将来追加が楽。
--   - body / equipment / key_shift はすべて任意。ただし全部空のログは
--     アプリ層で弾く。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.song_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  song_id     uuid NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,

  logged_at   date NOT NULL DEFAULT current_date,
  equipment   text,
  key_shift   int,
  body        text,

  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT song_logs_equipment_valid
    CHECK (equipment IS NULL OR equipment IN ('dam', 'joysound')),
  CONSTRAINT song_logs_key_shift_reasonable
    CHECK (key_shift IS NULL OR key_shift BETWEEN -12 AND 12)
);

-- ユーザーの楽曲ページで時系列降順に取り出すためのインデックス
CREATE INDEX IF NOT EXISTS song_logs_user_song_logged_at_idx
  ON public.song_logs (user_id, song_id, logged_at DESC, created_at DESC);

-- updated_at 自動更新 (set_updated_at は 001 で定義済み)
DROP TRIGGER IF EXISTS trg_song_logs_updated_at ON public.song_logs;
CREATE TRIGGER trg_song_logs_updated_at
  BEFORE UPDATE ON public.song_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: 自分のログだけ操作可能
-- ----------------------------------------------------------------------------
ALTER TABLE public.song_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS song_logs_select_own ON public.song_logs;
CREATE POLICY song_logs_select_own
  ON public.song_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS song_logs_insert_own ON public.song_logs;
CREATE POLICY song_logs_insert_own
  ON public.song_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS song_logs_update_own ON public.song_logs;
CREATE POLICY song_logs_update_own
  ON public.song_logs FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS song_logs_delete_own ON public.song_logs;
CREATE POLICY song_logs_delete_own
  ON public.song_logs FOR DELETE
  USING (auth.uid() = user_id);

GRANT ALL ON public.song_logs TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

-- ============================================================================
-- 047: weekly_rankings テーブル
-- ----------------------------------------------------------------------------
-- 目的:
--   Spotify Top 50 (JP) と Apple Music Top 100 (JP) を週次で取り込み、
--   ソース横断のスコアを合算した「総合ランキング」を /rankings ページに表示する。
--
--   ・週次スナップショット: (week_start, song_id) でユニーク。
--   ・sources: 各ソースでの順位を JSON で持つ。例:
--       { "spotify": 3, "apple": 5 }
--     ソースに無ければ null または key 無し。
--   ・score: Borda 風 (各ソースで N+1-rank → 合算)。
--   ・final_rank: score 降順で 1..N を採番。
--
--   week_start は ISO 週の月曜 (UTC) を採用。スクリプト側で吸収する。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.weekly_rankings (
  week_start  date    NOT NULL,
  song_id     uuid    NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  final_rank  int     NOT NULL,
  score       numeric NOT NULL,
  sources     jsonb   NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, song_id)
);

CREATE INDEX IF NOT EXISTS weekly_rankings_week_rank_idx
  ON public.weekly_rankings (week_start, final_rank);

-- RLS: 認証ユーザーは全件 SELECT 可能 (公開ランキングなので read all)
ALTER TABLE public.weekly_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_rankings_select_authenticated ON public.weekly_rankings;
CREATE POLICY weekly_rankings_select_authenticated
  ON public.weekly_rankings FOR SELECT
  TO authenticated
  USING (true);

-- anon にも公開する場合は下記を有効化 (現状は認証必須)
-- DROP POLICY IF EXISTS weekly_rankings_select_anon ON public.weekly_rankings;
-- CREATE POLICY weekly_rankings_select_anon
--   ON public.weekly_rankings FOR SELECT
--   TO anon
--   USING (true);

NOTIFY pgrst, 'reload schema';

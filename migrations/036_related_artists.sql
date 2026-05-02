-- ============================================================================
-- related_artists テーブル: アーティスト → 関連アーティストの順序付きマップ
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法: Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--
-- 用途:
--   アーティスト詳細ページの「関連するアーティスト」カルーセル用。
--   ジャンル overlap だけでは桑田佳祐 ↔ サザンや事務所/系統の関係が
--   拾えないため、Claude の知識で生成した手動マップを保持する。
--
-- 構造:
--   - artist_id: 起点アーティスト
--   - related_artist_id: 関連アーティスト
--   - rank: 表示順 (1=最も近い)
--   PRIMARY KEY (artist_id, related_artist_id)
--
--   どちらの artist_id も artists.id を FK 参照。アーティストが消えたら
--   ON DELETE CASCADE で勝手に消える。
--
-- ロード:
--   scripts/ingest-related-artists.ts が
--   scraper/output/related_artists.json を読んで upsert する。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.related_artists (
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  related_artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  rank smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (artist_id, related_artist_id),
  CHECK (artist_id <> related_artist_id),
  CHECK (rank >= 1)
);

-- 起点アーティストごとの並び替えで使う
CREATE INDEX IF NOT EXISTS related_artists_artist_id_rank_idx
  ON public.related_artists (artist_id, rank);

-- RLS: 認証ユーザーは全行 SELECT 可
ALTER TABLE public.related_artists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS related_artists_select_authenticated ON public.related_artists;
CREATE POLICY related_artists_select_authenticated
  ON public.related_artists FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.related_artists TO authenticated;
GRANT SELECT ON public.related_artists TO anon;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

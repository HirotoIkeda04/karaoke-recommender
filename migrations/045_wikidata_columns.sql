-- ============================================================================
-- 045: Wikidata / Wikipedia source columns
-- ----------------------------------------------------------------------------
-- 目的: 各アーティストとその楽曲を Wikidata の Q-ID に紐付けることで、
--   - 同じ Q-ID で複数回 INSERT されない (UPSERT key)
--   - 後続スクリプトが既に処理済の artist をスキップ可能
--   - 将来 Wikipedia 由来データの一括取り消しが可能 (source 識別)
--
-- 既存データへの影響なし。NULL 許可で追加。
-- ============================================================================

ALTER TABLE public.artists
  ADD COLUMN IF NOT EXISTS wikidata_qid       TEXT,
  ADD COLUMN IF NOT EXISTS wikipedia_article  TEXT;

-- 通常の UNIQUE 制約を使う (Postgres は NULL 同士を distinct 扱い)。
-- partial unique index だと PostgREST の `onConflict` が認識しない。
ALTER TABLE public.artists
  ADD CONSTRAINT artists_wikidata_qid_key UNIQUE (wikidata_qid);

ALTER TABLE public.songs
  ADD COLUMN IF NOT EXISTS wikidata_qid       TEXT,
  ADD COLUMN IF NOT EXISTS wikipedia_article  TEXT;

ALTER TABLE public.songs
  ADD CONSTRAINT songs_wikidata_qid_key UNIQUE (wikidata_qid);

NOTIFY pgrst, 'reload schema';

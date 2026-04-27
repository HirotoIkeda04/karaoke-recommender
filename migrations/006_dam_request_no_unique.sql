-- ============================================================================
-- dam_request_no を通常の UNIQUE 制約に変更
-- ============================================================================
-- 背景:
--   migration 005 で `WHERE dam_request_no IS NOT NULL` 付きの
--   partial unique index を作成したが、PostgREST の `?on_conflict=...`
--   指定はパーシャルインデックスを認識できず、seed-dam-songs.ts の upsert が
--   "42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--   specification" で失敗した。
--
--   通常の UNIQUE 制約に置き換えても、PostgreSQL は NULL を distinct 扱いする
--   ため、既存の NULL 行が衝突することはない。
-- ============================================================================

drop index if exists public.idx_songs_dam_request_no;

alter table public.songs
  add constraint songs_dam_request_no_key unique (dam_request_no);


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

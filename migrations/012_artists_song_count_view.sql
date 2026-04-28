-- ============================================================================
-- artists ラベリングUI用の集約 VIEW
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011_artists_and_genres.sql 実行済み
--
-- 用途:
--   /admin/artists のラベリングUI で
--     - 曲数が多いアーティスト順に並べる (song_count)
--     - ジャンル付与済みかでフィルタする (is_labeled)
-- ============================================================================

create or replace view public.artists_with_song_count as
select
  a.id,
  a.name,
  a.name_norm,
  a.genres,
  array_length(a.genres, 1) is not null as is_labeled,
  a.created_at,
  a.updated_at,
  coalesce(count(s.id), 0)::int as song_count
from public.artists a
left join public.songs s on s.artist_id = a.id
group by a.id;

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

-- ============================================================================
-- 検索タブ用: artists + songs を一発で引く RPC + pg_trgm index
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011 (artists) / 012 (artists_with_song_count VIEW) 実行済み
--
-- 背景:
--   旧 /songs ページは全曲 (1000 件チャンク * N) をクライアントに送って
--   メモリ内 filter していた。曲数増加で線形劣化するため、
--   サーバー側検索 (LIMIT 付) に切り替える。
--
-- 設計:
--   - 1 RPC で `{ artists: [...], songs: [...] }` を JSONB で返す
--   - artists.name_norm / songs.title / songs.artist に pg_trgm GIN index
--   - 高音域フィルタ (range_high_midi) は songs 側にのみ適用
--   - artist 結果には「最新リリースのジャケット画像」を 1 枚同梱
--     (アーティストページのヒーロー画像と一致させる)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. pg_trgm 拡張 + GIN index
-- ----------------------------------------------------------------------------

create extension if not exists pg_trgm;

-- artists: name_norm (NFKC + lower 済み) で前方/部分一致を高速化
create index if not exists idx_artists_name_norm_trgm
  on public.artists using gin (name_norm gin_trgm_ops);

-- songs: title / artist (denormalized) を ILIKE で引く際の高速化
-- 大文字小文字は trigram 正規化に任せる (gin_trgm_ops は ILIKE 対応)
create index if not exists idx_songs_title_trgm
  on public.songs using gin (title gin_trgm_ops);

create index if not exists idx_songs_artist_trgm
  on public.songs using gin (artist gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- 2. 検索 RPC: search_songs_and_artists
-- ----------------------------------------------------------------------------
-- 引数:
--   p_q            : クエリ文字列 (空文字 / 1 文字未満は空結果)
--   p_high_min_midi: 最高音の下限 (NULL=未指定)
--   p_high_max_midi: 最高音の上限 (NULL=未指定)
--   p_artist_limit : artists 結果の最大件数 (default 8)
--   p_song_limit   : songs 結果の最大件数 (default 50)
--
-- 戻り値: jsonb { artists: [...], songs: [...] }
--   artists[]: { id, name, genres, song_count, image_url }
--   songs[]:   songs テーブルの主要列 (id, title, artist, ...)
-- ----------------------------------------------------------------------------

create or replace function public.search_songs_and_artists(
  p_q              text,
  p_high_min_midi  int default null,
  p_high_max_midi  int default null,
  p_artist_limit   int default 8,
  p_song_limit     int default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q_norm     text;
  v_q_pattern  text;
  v_artists    jsonb;
  v_songs      jsonb;
begin
  -- 入力正規化: artists.name_norm と同じ NFKC + lower + trim
  v_q_norm := public.normalize_artist_name(coalesce(p_q, ''));

  if length(v_q_norm) = 0 then
    return jsonb_build_object('artists', '[]'::jsonb, 'songs', '[]'::jsonb);
  end if;

  v_q_pattern := '%' || v_q_norm || '%';

  -- --------------------------------------------------------------------------
  -- artists: name_norm の部分一致 + 完全一致/前方一致を優先
  -- --------------------------------------------------------------------------
  with matched as (
    select
      a.id,
      a.name,
      a.genres,
      a.song_count,
      case
        when a.name_norm = v_q_norm then 0
        when a.name_norm like v_q_norm || '%' then 1
        else 2
      end as match_rank,
      similarity(a.name_norm, v_q_norm) as sim
    from public.artists_with_song_count a
    where a.name_norm ilike v_q_pattern
    order by match_rank, sim desc, a.song_count desc nulls last
    limit greatest(p_artist_limit, 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'genres', m.genres,
      'song_count', m.song_count,
      'image_url', (
        select coalesce(s2.image_url_small, s2.image_url_medium)
        from public.songs s2
        where s2.artist_id = m.id
          and (s2.image_url_small is not null or s2.image_url_medium is not null)
        order by s2.release_year desc nulls last
        limit 1
      )
    )
    order by m.match_rank, m.sim desc, m.song_count desc nulls last
  ), '[]'::jsonb)
  into v_artists
  from matched m;

  -- --------------------------------------------------------------------------
  -- songs: title / artist の ILIKE + 高音域フィルタ
  --   - title 完全一致 → 前方一致 → 部分一致 の順でランク付け
  --   - 同ランク内では fame_score 降順 → release_year 降順
  -- --------------------------------------------------------------------------
  with matched as (
    select
      s.id,
      s.title,
      s.artist,
      s.release_year,
      s.range_low_midi,
      s.range_high_midi,
      s.falsetto_max_midi,
      s.image_url_small,
      s.image_url_medium,
      s.fame_score,
      case
        when lower(s.title) = v_q_norm then 0
        when lower(s.title) like v_q_norm || '%' then 1
        when public.normalize_artist_name(s.artist) = v_q_norm then 1
        else 2
      end as match_rank
    from public.songs s
    where (s.title ilike v_q_pattern or s.artist ilike v_q_pattern)
      and (p_high_min_midi is null or s.range_high_midi >= p_high_min_midi)
      and (p_high_max_midi is null or s.range_high_midi <= p_high_max_midi)
    order by
      match_rank,
      coalesce(s.fame_score, 0) desc,
      s.release_year desc nulls last,
      s.title
    limit greatest(p_song_limit, 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'artist', m.artist,
      'release_year', m.release_year,
      'range_low_midi', m.range_low_midi,
      'range_high_midi', m.range_high_midi,
      'falsetto_max_midi', m.falsetto_max_midi,
      'image_url_small', m.image_url_small,
      'image_url_medium', m.image_url_medium,
      'fame_score', m.fame_score
    )
    order by
      m.match_rank,
      coalesce(m.fame_score, 0) desc,
      m.release_year desc nulls last,
      m.title
  ), '[]'::jsonb)
  into v_songs
  from matched m;

  return jsonb_build_object('artists', v_artists, 'songs', v_songs);
end;
$$;

grant execute on function public.search_songs_and_artists(text, int, int, int, int)
  to authenticated, anon;

-- スキーマ再読込通知
notify pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

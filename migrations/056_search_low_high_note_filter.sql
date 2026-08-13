-- ============================================================================
-- 検索タブ: 音域フィルタを「最高音の下限/上限」から「最低音/最高音」に変更
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 032 (search_songs_and_artists) / 052 (get_search_recommendations) 実行済み
--
-- 背景:
--   これまでの絞り込みは「最高音がこの範囲にある曲」(range_high_midi の
--   下限と上限) だった。これを「自分の音域に収まる曲」を選ぶ形に改め、
--   最低音 (p_low_midi) と最高音 (p_high_midi) の 2 値で絞り込む。
--
--     - p_low_midi  指定時: range_low_midi  >= p_low_midi  (これより低い曲を除外)
--     - p_high_midi 指定時: range_high_midi <= p_high_midi (これより高い曲を除外)
--     - range_*_midi が NULL の曲は、該当フィルタ指定時は除外 (従来と同じ)
--
-- 引数名が変わるため CREATE OR REPLACE では置き換えられない
-- (cannot change name of input parameter)。旧関数を DROP してから作り直す。
-- 型シグネチャは同一なので PostgREST のオーバーロード曖昧化は起きない。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. search_songs_and_artists: 032 の再定義 (フィルタ引数のみ変更)
-- ----------------------------------------------------------------------------
-- 引数:
--   p_q            : クエリ文字列 (空文字 / 1 文字未満は空結果)
--   p_low_midi     : 最低音 (NULL=未指定。range_low_midi がこれ未満の曲を除外)
--   p_high_midi    : 最高音 (NULL=未指定。range_high_midi がこれ超の曲を除外)
--   p_artist_limit : artists 結果の最大件数 (default 8)
--   p_song_limit   : songs 結果の最大件数 (default 50)
--
-- 戻り値: jsonb { artists: [...], songs: [...] } (032 と同じ shape)
-- ----------------------------------------------------------------------------

drop function if exists public.search_songs_and_artists(text, int, int, int, int);

create function public.search_songs_and_artists(
  p_q              text,
  p_low_midi       int default null,
  p_high_midi      int default null,
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
  -- songs: title / artist の ILIKE + 音域フィルタ
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
      and (p_low_midi is null or s.range_low_midi >= p_low_midi)
      and (p_high_midi is null or s.range_high_midi <= p_high_midi)
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


-- ----------------------------------------------------------------------------
-- 2. get_search_recommendations: 052 の再定義 (フィルタ引数のみ変更)
-- ----------------------------------------------------------------------------
-- 返却順は 052 と同じ:
--   1. 条件に一致する最新週間ランキング曲（ランキング順）
--   2. 不足分を全楽曲から知名度順で補完（ランキング曲との重複なし）
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.get_search_recommendations(integer, integer, integer, integer[]);

CREATE FUNCTION public.get_search_recommendations(
  p_limit integer DEFAULT 50,
  p_low_midi integer DEFAULT NULL,
  p_high_midi integer DEFAULT NULL,
  p_decades integer[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH params AS (
    SELECT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100) AS result_limit
  ),
  latest_week AS (
    SELECT week_start
    FROM public.weekly_rankings
    ORDER BY week_start DESC
    LIMIT 1
  ),
  eligible_songs AS MATERIALIZED (
    SELECT
      s.id,
      s.title,
      s.artist,
      s.release_year,
      s.range_low_midi,
      s.range_high_midi,
      s.falsetto_max_midi,
      s.image_url_small,
      s.image_url_medium,
      s.duration_ms,
      s.fame_score,
      s.spotify_popularity,
      s.is_popular
    FROM public.songs s
    WHERE
      (
        p_low_midi IS NULL
        OR s.range_low_midi >= p_low_midi
      )
      AND (
        p_high_midi IS NULL
        OR s.range_high_midi <= p_high_midi
      )
      AND (
        COALESCE(cardinality(p_decades), 0) = 0
        OR ((s.release_year / 10) * 10) = ANY(p_decades)
      )
  ),
  ranked_matches AS MATERIALIZED (
    SELECT
      0 AS source_priority,
      wr.final_rank::bigint AS sort_order,
      s.id,
      s.title,
      s.artist,
      s.release_year,
      s.range_low_midi,
      s.range_high_midi,
      s.falsetto_max_midi,
      s.image_url_small,
      s.image_url_medium,
      s.duration_ms
    FROM latest_week lw
    JOIN public.weekly_rankings wr
      ON wr.week_start = lw.week_start
    JOIN eligible_songs s
      ON s.id = wr.song_id
  ),
  fallback_matches AS (
    SELECT
      1 AS source_priority,
      row_number() OVER (
        ORDER BY
          s.fame_score DESC NULLS LAST,
          s.spotify_popularity DESC NULLS LAST,
          s.is_popular DESC,
          s.title,
          s.id
      ) AS sort_order,
      s.id,
      s.title,
      s.artist,
      s.release_year,
      s.range_low_midi,
      s.range_high_midi,
      s.falsetto_max_midi,
      s.image_url_small,
      s.image_url_medium,
      s.duration_ms
    FROM eligible_songs s
    WHERE NOT EXISTS (
      SELECT 1
      FROM ranked_matches ranked
      WHERE ranked.id = s.id
    )
    ORDER BY
      s.fame_score DESC NULLS LAST,
      s.spotify_popularity DESC NULLS LAST,
      s.is_popular DESC,
      s.title,
      s.id
    LIMIT (SELECT result_limit FROM params)
  ),
  combined AS (
    SELECT * FROM ranked_matches
    UNION ALL
    SELECT * FROM fallback_matches
    ORDER BY source_priority, sort_order
    LIMIT (SELECT result_limit FROM params)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', id,
        'title', title,
        'artist', artist,
        'release_year', release_year,
        'range_low_midi', range_low_midi,
        'range_high_midi', range_high_midi,
        'falsetto_max_midi', falsetto_max_midi,
        'image_url_small', image_url_small,
        'image_url_medium', image_url_medium,
        'duration_ms', duration_ms
      )
      ORDER BY source_priority, sort_order
    ),
    '[]'::jsonb
  )
  FROM combined;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_search_recommendations(
  integer,
  integer,
  integer,
  integer[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_search_recommendations(
  integer,
  integer,
  integer,
  integer[]
) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

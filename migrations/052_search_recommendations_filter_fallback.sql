-- ============================================================================
-- 検索おすすめ: 絞り込みを LIMIT より先に適用し、不足分を全楽曲から補完する
-- ============================================================================
--
-- これまでは週間ランキング上位を先に LIMIT し、その小さな集合をクライアントで
-- 絞り込んでいたため、条件を追加するほど数件しか残らなかった。
-- 新しい関数は次の順序で最大 p_limit 件を返す。
--
--   1. 条件に一致する最新週間ランキング曲（ランキング順）
--   2. 不足分を全楽曲から知名度順で補完（ランキング曲との重複なし）
--
-- 関数シグネチャを変更するため、PostgREST が未対応のオーバーロードを認識
-- しないよう旧関数を先に削除する。
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_songs_release_decade
  ON public.songs (((release_year / 10) * 10))
  WHERE release_year IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_search_recommendations(integer);

CREATE OR REPLACE FUNCTION public.get_search_recommendations(
  p_limit integer DEFAULT 50,
  p_high_min_midi integer DEFAULT NULL,
  p_high_max_midi integer DEFAULT NULL,
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
        p_high_min_midi IS NULL
        OR s.range_high_midi >= p_high_min_midi
      )
      AND (
        p_high_max_midi IS NULL
        OR s.range_high_midi <= p_high_max_midi
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

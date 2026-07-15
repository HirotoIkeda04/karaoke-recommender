-- ============================================================================
-- 051: 検索タブの共有ブラウズデータを事前計算
-- ----------------------------------------------------------------------------
-- /songs の初期表示で全ユーザー共通のデータを毎回組み立てないよう、
-- ジャンルカバーとランキングプレビューを公開可能な1行JSONに集約する。
--
-- 読み取り: anon / authenticated（公開して安全な表示用データのみ）
-- 更新:     service_role から refresh_browse_snapshot() を実行
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.browse_snapshots (
  id               text        PRIMARY KEY,
  genre_covers     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ranking_covers   jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ranking_preview  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT browse_snapshots_genre_covers_object
    CHECK (jsonb_typeof(genre_covers) = 'object'),
  CONSTRAINT browse_snapshots_ranking_covers_array
    CHECK (jsonb_typeof(ranking_covers) = 'array'),
  CONSTRAINT browse_snapshots_ranking_preview_array
    CHECK (jsonb_typeof(ranking_preview) = 'array')
);

ALTER TABLE public.browse_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS browse_snapshots_public_read
  ON public.browse_snapshots;
CREATE POLICY browse_snapshots_public_read
  ON public.browse_snapshots FOR SELECT
  TO anon, authenticated
  USING (id = 'songs');

REVOKE ALL ON TABLE public.browse_snapshots FROM anon, authenticated;
GRANT SELECT ON TABLE public.browse_snapshots TO anon, authenticated;

-- service_role は migration 002 の default privileges でも付与されるが、
-- 新形式キーを使う環境でも確実に更新できるよう明示する。
GRANT ALL PRIVILEGES ON TABLE public.browse_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_browse_snapshot()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH browse_genres(genre_code) AS (
    VALUES
      ('j_pop'::text),
      ('j_rock'::text),
      ('anison'::text),
      ('vocaloid_utaite'::text),
      ('idol_female'::text),
      ('idol_male'::text),
      ('hiphop'::text)
  ),
  genre_candidates AS (
    SELECT
      bg.genre_code,
      s.artist_id,
      COALESCE(s.image_url_small, s.image_url_medium) AS cover_url,
      s.fame_score,
      s.spotify_popularity,
      s.id AS song_id
    FROM browse_genres bg
    JOIN public.artists a
      ON a.genres @> ARRAY[bg.genre_code]::text[]
    JOIN public.songs s
      ON s.artist_id = a.id
    WHERE COALESCE(s.image_url_small, s.image_url_medium) IS NOT NULL
  ),
  genre_artist_unique AS (
    SELECT DISTINCT ON (genre_code, artist_id)
      genre_code,
      artist_id,
      cover_url,
      fame_score,
      spotify_popularity,
      song_id
    FROM genre_candidates
    ORDER BY
      genre_code,
      artist_id,
      fame_score DESC NULLS LAST,
      spotify_popularity DESC NULLS LAST,
      song_id
  ),
  genre_cover_unique AS (
    SELECT DISTINCT ON (genre_code, cover_url)
      genre_code,
      cover_url,
      fame_score,
      spotify_popularity,
      song_id
    FROM genre_artist_unique
    ORDER BY
      genre_code,
      cover_url,
      fame_score DESC NULLS LAST,
      spotify_popularity DESC NULLS LAST,
      song_id
  ),
  genre_ranked AS (
    SELECT
      genre_code,
      cover_url,
      row_number() OVER (
        PARTITION BY genre_code
        ORDER BY
          fame_score DESC NULLS LAST,
          spotify_popularity DESC NULLS LAST,
          song_id
      ) AS cover_rank
    FROM genre_cover_unique
  ),
  genre_grouped AS (
    SELECT
      genre_code,
      jsonb_agg(cover_url ORDER BY cover_rank) AS covers
    FROM genre_ranked
    WHERE cover_rank <= 4
    GROUP BY genre_code
  ),
  genre_json AS (
    SELECT COALESCE(
      jsonb_object_agg(genre_code, covers),
      '{}'::jsonb
    ) AS value
    FROM genre_grouped
  ),
  latest_week AS (
    SELECT week_start
    FROM public.weekly_rankings
    ORDER BY week_start DESC
    LIMIT 1
  ),
  ranking_candidates AS (
    SELECT
      wr.final_rank,
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
    JOIN public.songs s
      ON s.id = wr.song_id
    ORDER BY wr.final_rank
    LIMIT 100
  ),
  ranking_rows AS (
    SELECT *
    FROM ranking_candidates
    ORDER BY final_rank
    LIMIT 5
  ),
  ranking_preview_json AS (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'rank', final_rank,
          'song', jsonb_build_object(
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
        )
        ORDER BY final_rank
      ),
      '[]'::jsonb
    ) AS value
    FROM ranking_rows
  ),
  ranking_cover_unique AS (
    SELECT DISTINCT ON (COALESCE(image_url_medium, image_url_small))
      COALESCE(image_url_medium, image_url_small) AS cover_url,
      final_rank
    FROM ranking_candidates
    WHERE COALESCE(image_url_medium, image_url_small) IS NOT NULL
    ORDER BY COALESCE(image_url_medium, image_url_small), final_rank
  ),
  ranking_cover_ranked AS (
    SELECT
      cover_url,
      row_number() OVER (ORDER BY final_rank) AS cover_rank
    FROM ranking_cover_unique
  ),
  ranking_covers_json AS (
    SELECT COALESCE(
      jsonb_agg(cover_url ORDER BY cover_rank)
        FILTER (WHERE cover_rank <= 4),
      '[]'::jsonb
    ) AS value
    FROM ranking_cover_ranked
  )
  INSERT INTO public.browse_snapshots (
    id,
    genre_covers,
    ranking_covers,
    ranking_preview,
    updated_at
  )
  SELECT
    'songs',
    genre_json.value,
    ranking_covers_json.value,
    ranking_preview_json.value,
    now()
  FROM genre_json, ranking_covers_json, ranking_preview_json
  ON CONFLICT (id) DO UPDATE SET
    genre_covers = EXCLUDED.genre_covers,
    ranking_covers = EXCLUDED.ranking_covers,
    ranking_preview = EXCLUDED.ranking_preview,
    updated_at = EXCLUDED.updated_at;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_browse_snapshot()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_browse_snapshot()
  TO service_role;

-- 検索モードを開いた時だけ、ランキング順の候補曲を取得する。
CREATE OR REPLACE FUNCTION public.get_search_recommendations(
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  WITH latest_week AS (
    SELECT week_start
    FROM public.weekly_rankings
    ORDER BY week_start DESC
    LIMIT 1
  ),
  recommendations AS (
    SELECT
      wr.final_rank,
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
    JOIN public.songs s
      ON s.id = wr.song_id
    ORDER BY wr.final_rank
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
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
      ORDER BY final_rank
    ),
    '[]'::jsonb
  )
  FROM recommendations;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_search_recommendations(integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_search_recommendations(integer)
  TO authenticated;

-- マイグレーション適用直後から空表示にならないよう初期値を生成する。
SELECT public.refresh_browse_snapshot();

NOTIFY pgrst, 'reload schema';

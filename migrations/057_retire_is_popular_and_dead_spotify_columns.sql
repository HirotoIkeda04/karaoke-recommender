-- ============================================================================
-- is_popular と死んだ Spotify 列の廃止
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 055 (スキップ TTL 復元) まで実行済み
--
-- 背景:
--   is_popular は初期スキーマで「カラ音で太字だった曲 = 代表曲」を区別する
--   フラグとして作られたが、その後のインポート経路 (seed-*, import-*) が
--   すべて無条件に true を書くようになり、現在は全 5,938 曲が true。
--   推薦 RPC の p_popular_only も何も絞っていない (実測で確認済み)。
--   知名度による絞り込み・並び替えの役割は fame_score / cert_score が
--   引き継いでいるため、列ごと廃止する。
--
--   spotify_popularity は 2026-02 の Spotify API 変更で Dev Mode アプリから
--   取得不能になり (全行 null)、spotify_preview_url は iTunes プレビュー
--   (054, itunes_preview_url 90%) への移行で役目を終えた (全行 null)。
--   どちらもデータが空のまま復活の見込みが無いので一緒に落とす。
--
--   spotify_track_id (インポートの重複排除キー) / spotify_isrc /
--   spotify_explicit / duration_ms / 取得リトライ管理列は現役なので残す。
--
-- 変更点:
--   1. get_unrated_songs_v2 から p_popular_only 引数と is_popular 条件を削除。
--      シグネチャが (int, boolean, boolean) → (int, boolean) に変わるため
--      CREATE OR REPLACE では置換できず、旧シグネチャを DROP してから作り直す
--      (046 と同じ手順)。オーバーロードを残すと PostgREST が呼び分けに迷うので
--      旧シグネチャは必ず消すこと。
--   2. songs から is_popular / spotify_popularity / spotify_preview_url を
--      DROP。部分インデックス idx_songs_popular は列と一緒に消える。
--   3. refresh_browse_snapshot (053) を spotify_popularity 抜きで再定義。
--      SQL 関数の本文はテキスト保存なので DROP COLUMN 自体は通ってしまうが、
--      放置すると夜間ルーチンの次回実行時に落ちる。
--   4. get_search_recommendations (056) を spotify_popularity / is_popular
--      抜きで再定義 (どちらも並び替えのタイブレークにだけ使われており、
--      全行 null / 全行 true なので挙動は変わらない)。
--   5. songs_with_genres ビュー (011) は `s.*` で songs に依存しており、
--      このままでは DROP COLUMN が依存エラーで失敗する。DROP → 列削除 →
--      同一定義で再作成 (s.* が新しい列構成を拾う)。アプリからの参照は無く
--      anon/authenticated への GRANT も元々無いので、再作成後の GRANT は不要。
--   6. 旧 get_unrated_songs (v1, 021 で v2 に置換済み・呼び出し元なし) を
--      DROP。本文が is_popular を参照しており、列削除後は呼ぶと壊れる
--      死に関数として残るだけなので、この機会に消す。
--
-- RPC 本体は 055 と完全に同一 (p_popular_only の削除以外の差分は無い)。
-- 特にスキップ TTL 20 日 (039 導入・055 復元) は仕様なので消さないこと。
-- refresh_browse_snapshot / get_search_recommendations も同様に、
-- 廃止列の削除以外は 053 / 056 と完全に同一。
--
-- 適用順の注意:
--   アプリ側は新シグネチャ ({p_limit, p_require_image}) で呼ぶコードを
--   先にデプロイ済みにしてから本 SQL を適用する。逆順だと旧コードの
--   RPC 呼び出しが「関数が見つからない」で失敗する。
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_unrated_songs_v2(int, boolean, boolean);
DROP FUNCTION IF EXISTS public.get_unrated_songs(int, boolean);

DROP VIEW IF EXISTS public.songs_with_genres;

ALTER TABLE public.songs
  DROP COLUMN IF EXISTS is_popular,
  DROP COLUMN IF EXISTS spotify_popularity,
  DROP COLUMN IF EXISTS spotify_preview_url;

-- 011 と同一定義。s.* なので廃止後の列構成を自動で反映する。
CREATE VIEW public.songs_with_genres AS
SELECT
  s.*,
  coalesce(nullif(s.genres, '{}'::text[]), a.genres) AS effective_genres,
  a.name AS artist_name_canonical
FROM public.songs s
LEFT JOIN public.artists a ON s.artist_id = a.id;

CREATE FUNCTION public.get_unrated_songs_v2(
  p_limit         int     default 20,
  p_require_image boolean default false
) returns setof public.songs
language sql
stable
security invoker
as $$
  with
  bucket_targets(bucket, target_pct) as (
    values
      ('2020s+',     0.40::double precision),
      ('2015-2019',  0.30::double precision),
      ('2010-2014',  0.15::double precision),
      ('2000-2009',  0.10::double precision),
      ('pre-2000',   0.05::double precision)
  ),

  default_genre_weights(genre, dw) as (
    values
      ('j_pop',           0.30::double precision),
      ('j_rock',          0.25::double precision),
      ('anison',          0.10::double precision),
      ('vocaloid_utaite', 0.07::double precision),
      ('idol_female',     0.05::double precision),
      ('idol_male',       0.05::double precision),
      ('rnb_soul',        0.04::double precision),
      ('western',         0.04::double precision),
      ('hiphop',          0.04::double precision),
      ('kpop',            0.02::double precision),
      ('game_bgm',        0.01::double precision),
      ('other',           0.005::double precision)
  ),

  user_pref_raw as (
    select genre, song_count::double precision as cnt
    from public.user_genre_distribution
    where user_id = auth.uid()
  ),
  user_pref_total as (
    select coalesce(sum(cnt), 0)::double precision as total from user_pref_raw
  ),

  mixed_genre_weights(genre, weight) as (
    select
      d.genre,
      case
        when (select total from user_pref_total) >= 10 then
          0.6 * coalesce(u.cnt, 0) / nullif((select total from user_pref_total), 0)
          + 0.4 * d.dw
        else
          d.dw
      end as weight
    from default_genre_weights d
    left join user_pref_raw u on u.genre = d.genre
  ),

  user_artist_pref as (
    select s.artist_id, count(*)::double precision as cnt
    from public.evaluations e
    join public.songs s on s.id = e.song_id
    where e.user_id = auth.uid()
      and e.rating in ('easy', 'medium', 'practicing')
      and s.artist_id is not null
    group by s.artist_id
  ),

  candidates as (
    select s.id,
      s.artist_id,
      s.fame_score,
      s.cert_score,
      s.release_year,
      coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[]) as effective_genres,
      case
        when s.release_year >= 2020 then '2020s+'
        when s.release_year >= 2015 then '2015-2019'
        when s.release_year >= 2010 then '2010-2014'
        when s.release_year >= 2000 then '2000-2009'
        else                              'pre-2000'
      end as bucket
    from public.songs s
    left join public.artists a on a.id = s.artist_id
    where not exists (
      -- スキップは TTL 20 日経つまで除外。それ以外の評価は永久除外。(039 復元)
      select 1 from public.evaluations e
      where e.user_id = auth.uid()
        and e.song_id = s.id
        and (
          e.rating <> 'skip'
          or e.updated_at >= now() - interval '20 days'
        )
    )
      and (
        p_require_image = false
        or s.image_url_large is not null
        or s.image_url_medium is not null
      )
      and not (
        coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[])
        @> array['enka_kayo']
      )
      and (
        coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[])
        && array['j_pop','j_rock','anison','vocaloid_utaite',
                 'idol_male','idol_female','rnb_soul','hiphop','kpop',
                 'western','game_bgm','other']
      )
  ),

  bucket_counts as (
    select bucket, count(*) as cnt from candidates group by bucket
  ),

  song_genre_score as (
    select c.id,
      coalesce(
        (
          select sum(mgw.weight)
          from unnest(c.effective_genres) as g
          left join mixed_genre_weights mgw on mgw.genre = g
        ),
        0.005
      ) as genre_score
    from candidates c
  ),

  song_artist_boost as (
    select c.id,
      case
        when uap.cnt is null then 1.0
        else least(1.0 + 0.5 * uap.cnt, 5.0)
      end as artist_boost
    from candidates c
    left join user_artist_pref uap on uap.artist_id = c.artist_id
  ),

  song_fame_factor as (
    select c.id,
      sqrt(
        coalesce(c.fame_score, 3.0)
        + case
            when c.release_year is null or c.release_year >= 2020 then 0
            else coalesce(c.cert_score, 0)::double precision * 0.4
          end
        + 1.0
      ) as fame_factor
    from candidates c
  ),

  weighted as (
    select c.id,
      sqrt(bt.target_pct / bc.cnt::double precision)
      * sgs.genre_score
      * sab.artist_boost
      * sff.fame_factor
      as weight
    from candidates c
    join bucket_counts    bc  using (bucket)
    join bucket_targets   bt  using (bucket)
    join song_genre_score sgs on sgs.id = c.id
    join song_artist_boost sab on sab.id = c.id
    join song_fame_factor sff on sff.id = c.id
  )

  select s.*
  from public.songs s
  where s.id in (
    select id from weighted
    order by random() * weight desc
    limit p_limit
  )
  order by random();
$$;

GRANT EXECUTE ON FUNCTION public.get_unrated_songs_v2(int, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- refresh_browse_snapshot: 053 の再定義 (spotify_popularity の削除のみ)
-- ----------------------------------------------------------------------------

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
      song_id
    FROM genre_candidates
    ORDER BY
      genre_code,
      artist_id,
      fame_score DESC NULLS LAST,
      song_id
  ),
  genre_cover_unique AS (
    SELECT DISTINCT ON (genre_code, cover_url)
      genre_code,
      cover_url,
      fame_score,
      song_id
    FROM genre_artist_unique
    ORDER BY
      genre_code,
      cover_url,
      fame_score DESC NULLS LAST,
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
    LIMIT 50
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

-- ----------------------------------------------------------------------------
-- get_search_recommendations: 056 の再定義
-- (spotify_popularity / is_popular のタイブレーク削除のみ)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_search_recommendations(
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
      s.fame_score
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

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

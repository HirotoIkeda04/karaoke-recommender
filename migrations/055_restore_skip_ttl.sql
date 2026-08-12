-- ============================================================================
-- スキップ TTL (20 日) の復元
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 046 (p_require_image 追加) まで実行済み
--
-- 背景:
--   039 で導入したスキップ TTL — rating='skip' の評価行は updated_at から
--   20 日経つまで推薦除外し、経過後は自動的に再評価候補に戻す — が、
--   044 (cert_score) と 046 (p_require_image) の get_unrated_songs_v2
--   再定義時に候補 CTE ごと書き戻されて黙って消えていた (退行)。
--   現行 046 では evaluations に行があれば rating 不問で永久除外となり、
--   src/app/(app)/actions.ts の markSkipped の doc コメント
--   (「TTL 20 日除外・再スキップで延長」) と実装が矛盾していた。
--
-- 変更点:
--   candidates の除外条件を 039 の TTL 版に戻す:
--     - rating <> 'skip' の評価は従来通り永久除外
--     - rating = 'skip' は updated_at >= now() - 20 日 の間だけ除外
--       (markSkipped は upsert + trg_evaluations_updated_at で updated_at が
--        更新されるため、再スキップで TTL が延長される)
--   それ以外のロジックは 046 と完全に同一。
--
-- 復元しないもの (2026-08-13 に方針確認済み):
--   039 の per-artist cap (同一アーティスト最大 2 曲/バッチ) と
--   artist_boost 減衰 (1+0.3×cnt, cap 2.5) は復元しない。
--   ホームがアーティスト組 (レコードデッキ) 表示になり、同一アーティスト
--   複数曲はグループにまとまるため cap は不要と判断。
--
-- 注意:
--   シグネチャは 046 の (int, boolean, boolean) から変更しないため、
--   046 と違い旧シグネチャの DROP は不要 (CREATE OR REPLACE で置換できる)。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unrated_songs_v2(
  p_limit         int     default 20,
  p_popular_only  boolean default false,
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
      and (p_popular_only = false or s.is_popular = true)
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

GRANT EXECUTE ON FUNCTION public.get_unrated_songs_v2(int, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

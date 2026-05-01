-- ============================================================================
-- 推薦の重み付けに有名度 (fame_score) を組み込む
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 029 (fame_score カラム追加 + apply:fame で値投入済み) まで実行済み
--
-- 背景:
--   ユーザーの「場が白けない曲を推薦してほしい」という要件に応えるため、
--   日本語 Wikipedia の累計 pageviews 由来の fame_score を推薦の重みに加える。
--   詳細な経緯は 2026-04-30 のセッションログを参照。
--
-- 設計:
--   fame_factor = sqrt(coalesce(fame_score, 3.0) + 1.0)
--
--   この曲線の意図:
--     - 0 (記事なし)  → sqrt(1) = 1.0    (floor。ペナルティではないが boost なし)
--     - 4.0 (有名)    → sqrt(5) = 2.24
--     - 5.0 (超有名)  → sqrt(6) = 2.45
--     - 6.0 (鉄板)    → sqrt(7) = 2.65
--     - NULL (未計算) → sqrt(4) = 2.00   (バックフィル前の曲を不当に下げない)
--
--   sqrt をかけているのは、score が log10 ベースなのでさらに log を取ると
--   差が消えるが、線形だと 0 の floor で完全死亡する曲が出るのを避けるため。
--   結果として top と bottom の比率は ~2.65x。既存の artist_boost (1-5x)、
--   genre_score (0.005-0.30) と同じ動的範囲に収まる。
--
-- 変更:
--   weight = sqrt(year_term) × genre_score × artist_boost
--          ↓
--   weight = sqrt(year_term) × genre_score × artist_boost × fame_factor
--
-- 効果:
--   ・「友達の前で歌っても白けない」鉄板曲が確率的に上に出やすくなる
--   ・ただし純粋なフィルタではないので、マイナー曲も時々混ざる (= 多様性維持)
--   ・fame_score が NULL の曲 (バックフィル待ち) も平均的に扱われる
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unrated_songs_v2(
  p_limit        int     default 20,
  p_popular_only boolean default false
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
      select 1 from public.evaluations e
      where e.user_id = auth.uid() and e.song_id = s.id
    )
      and (p_popular_only = false or s.is_popular = true)
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
    -- fame_score=0 → sqrt(1)=1.0,  4.0 → 2.24, 5.0 → 2.45, 6.0 → 2.65
    -- NULL (未計算) → sqrt(4)=2.0 (バックフィル前の曲を中立扱い)
    select c.id,
      sqrt(coalesce(c.fame_score, 3.0) + 1.0) as fame_factor
    from candidates c
  ),

  -- 重み = sqrt(year_term) × genre_score × artist_boost × fame_factor
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

GRANT EXECUTE ON FUNCTION public.get_unrated_songs_v2 TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

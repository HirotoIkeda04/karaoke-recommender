-- ============================================================================
-- 未ラベル曲の genre_score fallback を更に下げる (0.015 → 0.001)
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 016 まで実行済み
--
-- 背景:
--   未ラベル (effective_genres = '{}') の pre-2000 曲が 561 曲存在し、
--   fallback 0.015 が適用されることで、適切に enka_kayo タグ済の曲 (0.003)
--   よりも 5 倍重い扱いになっていた。
--   結果として「演歌のような古い曲」が deck に異様な頻度で出現していた。
--
-- 変更:
--   未ラベル fallback: 0.015 → 0.001 (enka_kayo 0.003 より低い最低層)
--
-- 副作用:
--   未ラベルアーティスト/曲は事実上 deck から除外される。
--   恒久的解決のため、未ラベルアーティストを bulk-label-artists.ts または
--   /admin/artists UI でラベル付けする運用が望ましい。
-- ============================================================================

create or replace function public.get_unrated_songs(
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
      ('2020s+',     0.30::double precision),
      ('2015-2019',  0.25::double precision),
      ('2010-2014',  0.20::double precision),
      ('2000-2009',  0.15::double precision),
      ('pre-2000',   0.10::double precision)
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
      ('enka_kayo',       0.003::double precision),
      ('other',           0.003::double precision)
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
  ),

  bucket_counts as (
    select bucket, count(*) as cnt from candidates group by bucket
  ),

  -- 未ラベル fallback: 0.001 (enka_kayo 0.003 より低い最低層)
  -- 016 では 0.015 だったため未ラベル曲が過大評価されていた
  song_genre_score as (
    select c.id,
      coalesce(
        (
          select sum(mgw.weight)
          from unnest(c.effective_genres) as g
          left join mixed_genre_weights mgw on mgw.genre = g
        ),
        0.001
      ) as genre_score
    from candidates c
  ),

  song_artist_boost as (
    select c.id,
      coalesce(
        least(1.0 + 0.5 * uap.cnt, 5.0),
        1.0
      ) as artist_boost
    from candidates c
    left join user_artist_pref uap on uap.artist_id = c.artist_id
  ),

  weighted as (
    select c.id,
      sqrt(bt.target_pct / bc.cnt::double precision)
      * (sgs.genre_score * sgs.genre_score)
      * sab.artist_boost
      as weight
    from candidates c
    join bucket_counts    bc  using (bucket)
    join bucket_targets   bt  using (bucket)
    join song_genre_score sgs on sgs.id = c.id
    join song_artist_boost sab on sab.id = c.id
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

grant execute on function public.get_unrated_songs to authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

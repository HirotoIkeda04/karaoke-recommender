-- ============================================================================
-- 演歌・歌謡曲のデフォルト重みを更に下げる + 未ラベル fallback も低めに
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 014 実行済み
--
-- 背景:
--   014 のデフォルト重み (enka_kayo = 0.03) でも、年代IPW で pre-2000 が
--   10% 取られる設計 + その年代に演歌候補が多いため、deck 上で演歌が
--   実効的に 10% 前後出てしまう。
--   ユーザーフィードバック: "演歌は20曲に1回 (5%) でも十分すぎる"。
--
-- 変更:
--   1. enka_kayo: 0.03 → 0.003 (最低層、other と同等)
--   2. ジャンル未付与曲の fallback: 0.05 → 0.015
--      → 未ラベル曲が中位ジャンルと同格に扱われる問題を抑制
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
  -- 年代バケット目標分布 (003 / 014 と同じ)
  bucket_targets(bucket, target_pct) as (
    values
      ('2020s+',     0.30::double precision),
      ('2015-2019',  0.25::double precision),
      ('2010-2014',  0.20::double precision),
      ('2000-2009',  0.15::double precision),
      ('pre-2000',   0.10::double precision)
  ),

  -- デフォルトのジャンル重み (J-POP / 邦ロック 多め、演歌は最低層)
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
      ('enka_kayo',       0.003::double precision),  -- 014 から大幅減
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

  candidates as (
    select s.id,
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

  -- 未ラベル fallback を 0.015 に下げる (014 では 0.05)
  song_genre_score as (
    select c.id,
      coalesce(
        (
          select sum(mgw.weight)
          from unnest(c.effective_genres) as g
          left join mixed_genre_weights mgw on mgw.genre = g
        ),
        0.015
      ) as genre_score
    from candidates c
  ),

  weighted as (
    select c.id,
      (bt.target_pct / bc.cnt::double precision) * sgs.genre_score as weight
    from candidates c
    join bucket_counts  bc using (bucket)
    join bucket_targets bt using (bucket)
    join song_genre_score sgs on sgs.id = c.id
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

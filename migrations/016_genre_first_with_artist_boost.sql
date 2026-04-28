-- ============================================================================
-- 評価タブ推薦アルゴリズムを「ジャンル優先 + アーティストブースト」に拡張
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 015 まで実行済み
--
-- 変更点 (重み式):
--
--   旧 (015): weight = year_term × genre_score
--   新 (016): weight = sqrt(year_term) × genre_score^2 × artist_boost
--
--   - sqrt(year_term)  : 年代影響を弱める (年代分布の偏り是正は緩やかに維持)
--   - genre_score^2     : ジャンル選好の差を増幅 (J-POP/邦ロック等を強く優先)
--   - artist_boost      : 評価済みアーティストの曲を上振れさせる
--                         B + 上限キャップ案: 1.0 + 0.5 × eval_count, 最大 5.0
--
-- アーティストブーストの定義:
--   - 評価種別 ∈ {easy, medium, practicing} の評価数 (= eval_count)
--   - hard 評価は「無視」(ペナルティもブーストもなし、中立扱い)
--   - 未評価アーティストは boost = 1.0
--
-- 期待効果:
--   - 演歌や古い曲が更に減る (ジャンル指数2乗 + 年代影響弱化)
--   - 「米津玄師 1曲評価済」→ 米津の他曲が出やすくなる (B 倍率)
--   - 「米津 10曲評価済」→ 上限 5x で頭打ち、deck 占有を防ぐ
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
  -- 年代バケット目標分布 (003 / 014 / 015 と同じ)
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

  -- アーティスト別の評価実績 (easy/medium/practicing のみ)
  -- hard 評価は無視 (中立扱い)
  user_artist_pref as (
    select s.artist_id, count(*)::double precision as cnt
    from public.evaluations e
    join public.songs s on s.id = e.song_id
    where e.user_id = auth.uid()
      and e.rating in ('easy', 'medium', 'practicing')
      and s.artist_id is not null
    group by s.artist_id
  ),

  -- 候補曲 (artist_id を含めるよう拡張)
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

  -- 各曲のジャンルスコア (未ラベル fallback は 0.015)
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

  -- 各曲のアーティストブースト
  -- 評価実績ありなら 1 + 0.5 * eval_count, 最大 5.0
  -- 評価実績なし or artist_id が NULL なら 1.0
  song_artist_boost as (
    select c.id,
      coalesce(
        least(1.0 + 0.5 * uap.cnt, 5.0),
        1.0
      ) as artist_boost
    from candidates c
    left join user_artist_pref uap on uap.artist_id = c.artist_id
  ),

  -- 最終重み
  --   weight = sqrt(year_term) × genre_score^2 × artist_boost
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

  -- 重み付きランダム抽出 + デッキ内はランダム順
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

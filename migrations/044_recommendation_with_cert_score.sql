-- ============================================================================
-- 推薦の重みに RIAJ 認定 (cert_score) を組み込む
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 043 (cert_score カラム追加 + apply:cert で値投入済み) まで実行済み
--
-- 背景:
--   fame_score (Wikipedia pageviews) は古典曲 (release < 2020) を取りこぼす傾向。
--   PoC (scraper/output/poc_fame/report_v2.md) で:
--     - fame_score 単独:           Spearman +0.151
--     - fame_score + cert_score:   Spearman +0.278 (約 2 倍改善)
--   特に「カラオケ定番だが MV 視聴数の少ない 90s〜10s 邦楽」を救う効果。
--
--   詳細な経緯は 2026-05-04 のセッションログを参照。
--
-- 設計:
--   adjusted_fame =
--     coalesce(fame_score, 3.0)                           -- 既存の Wikipedia 由来
--     + (cert_boost が古典曲のみに作用)
--
--   cert_boost = case
--     when release_year is null or release_year >= 2020   -- 現代曲
--          then 0                                          -- 認定を使わない (YouTube 等で十分)
--     else coalesce(cert_score, 0)::double precision * 0.4 -- 古典曲は加点
--   end
--
--   fame_factor = sqrt(adjusted_fame + 1.0)
--
--   この設計の意図:
--     - 現代曲: 既存挙動と完全互換 (fame_score だけで判定)
--     - 古典曲のミリオン認定 (cert=5) → +2.0 ブースト
--       例: fame=4.0 + cert=5 → adjusted=6.0 → sqrt(7)=2.65 (= 「鉄板」相当)
--     - 古典曲のゴールド (cert=1) → +0.4 ブースト (緩やか)
--     - 古典の cert=0 (本当に未認定) → 既存挙動と同じ
--     - PoC 上の最適切替年は 2020 (RECENCY_THRESHOLD_YEARS=6 から計算)
--
-- 値の動的範囲:
--   旧 (031):  1.0 (fame=0)  〜 2.65 (fame=6)
--   新 (044):  1.0 (fame=0)  〜 ~3.16 (fame=5, cert=5, 古典)
--   既存 artist_boost (1-5x), genre_score (0.005-0.30) と整合する範囲。
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
    -- adjusted_fame = fame_score + cert_boost (古典曲のみ)
    --
    -- 例:
    --   現代曲, fame=5.0, cert=5    → adj=5.0,  sqrt(6)=2.45  (cert は無視)
    --   古典曲, fame=4.0, cert=5    → adj=6.0,  sqrt(7)=2.65  (鉄板認定)
    --   古典曲, fame=3.0, cert=2    → adj=3.8,  sqrt(4.8)=2.19 (プラチナ加点)
    --   古典曲, fame=NULL, cert=NULL → adj=3.0, sqrt(4)=2.0   (中立)
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

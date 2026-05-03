-- ============================================================================
-- 推薦の多様性向上 + スキップ TTL 対応
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 038 (rating_type に 'skip' 追加) まで実行済み
--
-- 背景:
--   ユーザーから以下の問題提起:
--     1. 「知らない/スキップ」した曲が同日にまた出てくる
--     2. 同じようなアーティストばかり出てくる
--     3. 最低限のばらつきが保証されていない
--
--   それぞれに対応する変更を 1 ファイルにまとめて投入する。
--
-- 変更点:
--   (A) スキップ TTL — 評価行 rating='skip' は updated_at から 20 日経つまで
--       推薦から除外。20 日経過後は自動的に再評価候補に戻る。
--       (handleSkip 側で markSkipped を upsert するので、再スキップで TTL 延長)
--
--   (B) per-artist cap — 同一アーティスト最大 2 曲/バッチ。
--       partition by artist_id した row_number で先に上位 2 件に絞ってから
--       全体ソートに渡すことで、artist_boost が高い 1 アーティストが
--       上位 20 件を独占する事態を構造的に防ぐ。
--
--   (C) artist_boost taming — `1 + 0.5×cnt` (cap 5.0) を `1 + 0.3×cnt` (cap 2.5) に。
--       評価 5 件で飽和し、好きなアーティストの曲が無限ループしにくくなる。
--       per-artist cap と組み合わせるので、boost を強めに保つ必要が無い。
--
--   学習信号 (user_genre_distribution / user_artist_pref) は引き続き
--   rating IN ('easy','medium','practicing') で絞っているため、
--   'skip' 行はジャンル/アーティスト嗜好に影響しない。
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
      -- (A) スキップは TTL 20 日経つまで除外。それ以外の評価は永久除外。
      select 1 from public.evaluations e
      where e.user_id = auth.uid()
        and e.song_id = s.id
        and (
          e.rating <> 'skip'
          or e.updated_at >= now() - interval '20 days'
        )
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
    -- (C) 1 + 0.3×cnt (cap 2.5)。評価 5 件で飽和、好きアーティストの曲が
    -- 無限ループしにくくなる。per-artist cap と組み合わせるので強くしすぎない。
    select c.id,
      case
        when uap.cnt is null then 1.0
        else least(1.0 + 0.3 * uap.cnt, 2.5)
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
      c.artist_id,
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
  ),

  -- (B) 同一アーティスト最大 2 曲/バッチ。
  -- artist_id NULL は 1 件ごとに独立 partition (id を partition key に使う)。
  per_artist_ranked as (
    select id, artist_id, weight,
      row_number() over (
        partition by coalesce(artist_id::text, id::text)
        order by random() * weight desc
      ) as rn_within_artist
    from weighted
  )

  select s.*
  from public.songs s
  where s.id in (
    select id from per_artist_ranked
    where rn_within_artist <= 2
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

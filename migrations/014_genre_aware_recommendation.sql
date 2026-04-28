-- ============================================================================
-- ジャンル考慮型レコメンド (get_unrated_songs 拡張) + ユーザージャンル分布 view
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011 (artists/genres) / 012 (view) / 013 (grants) 実行済み
--
-- 変更点:
--   1. user_genre_distribution view を追加
--      - 評価 (easy / medium / practicing) 済み楽曲のジャンル分布をユーザー毎に集計
--      - 「歌える曲」のジャンル割合 = ユーザー嗜好プロフィールとして利用
--   2. get_unrated_songs を拡張
--      - 既存: 年代バケット IPW (2020+ 30%, 2015-19 25%, ... 1999以前 10%)
--      - 追加: ジャンル重み (J-POP / 邦ロック を多め)
--          - 評価 10件未満 → デフォルト重みのみ
--          - 評価 10件以上 → 60% ユーザー個人分布 + 40% デフォルト (smoothing)
--      - 最終重み = 年代重み × ジャンルスコア
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. user_genre_distribution view
-- ----------------------------------------------------------------------------
-- 「得意」「練習中」「普通」の評価済み楽曲のみを集計対象とする。
-- 「苦手」(hard) は除外 — 歌える曲ではないので嗜好プロフィールに含めない。
--
-- ジャンル決定: songs.genres (曲単位上書き) を優先、空なら artists.genres を継承。
-- 1曲が複数ジャンルなら全てに 1 カウント。

create or replace view public.user_genre_distribution as
with effective as (
  select
    e.user_id,
    e.song_id,
    coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[]) as genres
  from public.evaluations e
  join public.songs s on s.id = e.song_id
  left join public.artists a on a.id = s.artist_id
  where e.rating in ('easy', 'medium', 'practicing')
)
select
  user_id,
  unnest(genres) as genre,
  count(*) as song_count
from effective
group by user_id, genre;

grant select on public.user_genre_distribution to authenticated;


-- ----------------------------------------------------------------------------
-- 2. get_unrated_songs (年代 × ジャンル の二重重み付け)
-- ----------------------------------------------------------------------------

create or replace function public.get_unrated_songs(
  p_limit        int     default 20,
  p_popular_only boolean default false
) returns setof public.songs
language sql
stable
security invoker
as $$
  with
  -- 年代バケット目標分布 (003 と同じ)
  bucket_targets(bucket, target_pct) as (
    values
      ('2020s+',     0.30::double precision),
      ('2015-2019',  0.25::double precision),
      ('2010-2014',  0.20::double precision),
      ('2000-2009',  0.15::double precision),
      ('pre-2000',   0.10::double precision)
  ),

  -- デフォルトのジャンル重み (J-POP / 邦ロック 多め)
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
      ('enka_kayo',       0.03::double precision),
      ('kpop',            0.02::double precision),
      ('game_bgm',        0.01::double precision),
      ('other',           0.005::double precision)
  ),

  -- このユーザーのジャンル嗜好 (得意/練習中/普通 のみ)
  user_pref_raw as (
    select genre, song_count::double precision as cnt
    from public.user_genre_distribution
    where user_id = auth.uid()
  ),
  user_pref_total as (
    select coalesce(sum(cnt), 0)::double precision as total from user_pref_raw
  ),

  -- ミックス重み: 評価 10 件以上で個人嗜好を反映、未満ならデフォルトのみ
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

  -- 未評価候補曲 + 年代バケット + 有効ジャンル
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

  -- 各曲のジャンルスコア = 各ジャンルタグの mixed weight の合計
  -- ジャンル未付与曲は固定値 (0.05) で足切り回避
  song_genre_score as (
    select c.id,
      coalesce(
        (
          select sum(mgw.weight)
          from unnest(c.effective_genres) as g
          left join mixed_genre_weights mgw on mgw.genre = g
        ),
        0.05
      ) as genre_score
    from candidates c
  ),

  -- 最終重み = 年代重み × ジャンルスコア
  weighted as (
    select c.id,
      (bt.target_pct / bc.cnt::double precision) * sgs.genre_score as weight
    from candidates c
    join bucket_counts  bc using (bucket)
    join bucket_targets bt using (bucket)
    join song_genre_score sgs on sgs.id = c.id
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

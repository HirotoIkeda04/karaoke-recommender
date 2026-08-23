-- ============================================================================
-- デッキシード抽選を有名曲のみに絞る
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 058 (get_deck_seeds) 適用済み
--
-- 背景:
--   ホームには有名曲だけを出したい (2026-08-24 ユーザー要望)。「有名曲」の
--   基準はアーティストページの「人気の楽曲」セクションと同一:
--     max(coalesce(fame_score, 0), coalesce(cert_score, 0)) > 0
--   (fame_score = Wikipedia 閲覧数由来、cert_score = RIAJ 認定由来。
--    どちらかが付いていれば有名曲とみなす)。
--
--   実測 (2026-08-24): 画像ありの候補 4,852 曲 → 有名曲条件で 2,607 曲、
--   有名曲を持つアーティストは 712 組。バラエティには十分な母数。
--
-- 変更点:
--   candidates に有名曲条件を 1 行追加。それ以外は 058 と完全に同一
--   (スキップ TTL 20 日・対数形サンプリングは仕様。消さないこと)。
--   組の肉付け (deck.ts の同アーティスト人気曲取得) にも同条件を追加済み。
--   在庫数 (stock 補正) と代表曲も自動的に有名曲だけで数えることになる。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_deck_seeds(
  p_count              int    default 7,
  p_exclude_artist_ids uuid[] default '{}'::uuid[]
) returns setof public.songs
language sql
stable
security invoker
as $$
  with
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

  -- ホームに出せる曲 = 在庫。除外条件は deck.ts の isExcludedFromDeck と 1:1。
  candidates as (
    select s.id,
      s.artist_id,
      s.fame_score,
      s.cert_score,
      s.release_year,
      coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[]) as effective_genres
    from public.songs s
    left join public.artists a on a.id = s.artist_id
    where s.artist_id is not null
      and not (s.artist_id = any(coalesce(p_exclude_artist_ids, '{}'::uuid[])))
      and not exists (
        -- スキップは TTL 20 日経つまで除外。それ以外の評価は永久除外。
        select 1 from public.evaluations e
        where e.user_id = auth.uid()
          and e.song_id = s.id
          and (
            e.rating <> 'skip'
            or e.updated_at >= now() - interval '20 days'
          )
      )
      and (s.image_url_large is not null or s.image_url_medium is not null)
      -- 有名曲のみ: アーティストページの「人気の楽曲」と同じ基準 (060)
      and greatest(coalesce(s.fame_score, 0), coalesce(s.cert_score, 0)::double precision) > 0
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

  -- 曲単位の知名度係数 (v2 の song_fame_factor と同一式)
  song_fame as (
    select c.id, c.artist_id,
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

  -- アーティスト単位に集約した在庫と各係数の材料
  artist_pool as (
    select
      c.artist_id,
      count(*)::double precision as remaining,
      max(sf.fame_factor)        as fame,
      max(c.release_year)        as latest_year
    from candidates c
    join song_fame sf on sf.id = c.id
    group by c.artist_id
  ),

  artist_weighted as (
    select
      ap.artist_id,
      -- genre_score: artists.genres への嗜好適合 (songs.genres は全曲空)
      greatest(
        coalesce(
          (
            select sum(mgw.weight)
            from unnest(coalesce(a.genres, '{}'::text[])) as g
            left join mixed_genre_weights mgw on mgw.genre = g
          ),
          0.005
        ),
        0.005
      )
      * ap.fame
      -- familiarity: 高評価アーティストは最大 2 倍
      * case
          when uap.cnt is null then 1.0
          else least(1.0 + 0.5 * uap.cnt, 2.0)
        end
      -- stock: 在庫 1 曲のアーティストを弱く抑える (足切りはしない)
      * sqrt(least(ap.remaining, 4.0) / 4.0)
      -- recency: 在庫の最新曲の年で 0.7〜1.3
      * case
          when ap.latest_year is null   then 0.85
          when ap.latest_year >= 2020   then 1.30
          when ap.latest_year >= 2015   then 1.15
          when ap.latest_year >= 2010   then 1.00
          when ap.latest_year >= 2000   then 0.85
          else                               0.70
        end
      as weight
    from artist_pool ap
    join public.artists a on a.id = ap.artist_id
    left join user_artist_pref uap on uap.artist_id = ap.artist_id
  ),

  -- Efraimidis–Spirakis: key = random()^(1/weight) の上位 p_count 組。
  -- power() は低重み × 小さい乱数で double が underflow するため (22003)、
  -- 単調同値な対数形 ln(random())/weight (降順) で比較する。
  sampled_artists as (
    select artist_id
    from artist_weighted
    order by
      ln(greatest(random(), 1e-300)) / greatest(weight, 1e-9) desc
    limit greatest(p_count, 0)
  ),

  -- 各当選アーティストの代表曲 = 在庫の中で最も有名な曲
  representative as (
    select distinct on (c.artist_id) c.id
    from candidates c
    join sampled_artists sa on sa.artist_id = c.artist_id
    order by c.artist_id,
      c.fame_score desc nulls last,
      c.cert_score desc nulls last,
      c.id
  )

  select s.*
  from public.songs s
  join representative r on r.id = s.id
  order by random();
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

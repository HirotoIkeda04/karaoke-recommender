-- ============================================================================
-- アーティストファーストのデッキシード抽選 (get_deck_seeds)
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 057 (is_popular 廃止) まで実行済み
--
-- 背景:
--   ホームのレコードデッキは「7 アーティスト × 5 曲」なのに、シード選出は
--   曲単位の重み付き抽選 (get_unrated_songs_v2, 20 曲) からアーティスト重複を
--   間引く間接方式だった。実測 (2026-08-24) では、artist_boost (上限 5 倍) と
--   `order by random() * weight desc` の増幅が重なり、20 曲が平均 5.2
--   アーティストに収束。7 組が揃わない上、back number / Mrs. GREEN APPLE は
--   デッキ 200 回シミュレーションで出現率 100% と、顔ぶれがほぼ固定だった。
--
-- 設計 (2026-08-24 ユーザー確認済み):
--   - 抽選の単位を曲からアーティストに変える。返り値は従来同様 setof songs
--     だが、1 行 = 1 アーティスト (そのアーティストの未評価トップ曲) を
--     構造で保証する。呼び出し側 (deck.ts) の組み立てはほぼ無変更。
--   - なじみ (高評価履歴) は固定枠ではなく重みのみ。ブースト上限は
--     旧 5.0 → 2.0 に圧縮。
--   - 抽選は Efraimidis–Spirakis 法 `power(random(), 1/weight)`。
--     旧 `random() * weight` は重み差を過剰増幅し「ほぼ確実に当選」を
--     作ってしまうため使わない。
--   - 関連アーティスト (artist_relationships, 構築中) はデータ到着後に
--     スコアの加点要素として追加する予定。
--
-- 重みの構成 (アーティスト単位):
--   genre_score × fame × familiarity × stock × recency
--     - genre_score : artists.genres へのユーザー嗜好 (60%) + 既定値 (40%)。
--                     v2 の mixed_genre_weights と同一ロジック。
--     - fame        : 在庫曲の sqrt(fame_score + cert 補正 + 1) の最大値。
--                     v2 の song_fame_factor と同一式を曲に適用し max を取る。
--     - familiarity : least(1 + 0.5 × 高評価曲数, 2.0)。
--     - stock       : sqrt(least(在庫数, 4) / 4)。在庫 1 曲 (寂しい組) を
--                     0.5 倍に抑えるだけの弱い補正。足切りはしない
--                     (skip TTL 切れで在庫が戻った時の挙動を単純に保つ)。
--     - recency     : 在庫の最新 release_year で 0.7〜1.3。v2 の年代バケットの
--                     代替 (アーティスト単位では新しめをやや優遇する程度)。
--
-- 引数:
--   p_count             : 返すアーティスト (= 行) 数。既定 7。
--   p_exclude_artist_ids: 除外するアーティスト。deck.ts が cookie 復元済み
--                         シードのアーティストを渡す。これが無いと補充抽選が
--                         既存の組と衝突して 7 組に満たなくなる。
--
-- 除外条件は v2 と同一 (スキップ TTL 20 日は仕様。deck.ts の
-- isExcludedFromDeck と 1:1 対応を維持すること)。画像必須はホーム専用
-- RPC になったため引数ではなく本文に固定した。
--
-- 適用順の注意:
--   この migration は新関数の追加のみで既存には触れないため、アプリの
--   デプロイ前に適用してよい (むしろ先に適用するとダウンタイムゼロ)。
--   旧 get_unrated_songs_v2 の削除は 059 (デプロイ完了後に適用) で行う。
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

  -- ホームに出せる曲 = 在庫。除外条件は get_unrated_songs_v2 (055/057) と
  -- 完全に一致させる (deck.ts の isExcludedFromDeck と 1:1)。
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
      -- familiarity: 高評価アーティストは最大 2 倍 (旧 5 倍から圧縮)
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
  -- random()*weight と違い、重みは「当選確率の比」として正しく効く。
  -- power() をそのまま使うと低重み × 小さい乱数で double が underflow して
  -- 22003 エラーになるため (実際に起きた)、単調同値な対数形
  -- ln(random())/weight (降順) で比較する。
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

GRANT EXECUTE ON FUNCTION public.get_deck_seeds(int, uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

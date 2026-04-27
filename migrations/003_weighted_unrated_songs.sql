-- ============================================================================
-- get_unrated_songs を「目標分布マッチング (IPW)」で実装
-- ============================================================================
-- 目的: スワイプデッキの年代分布を、DB の元データの年代分布から独立させる。
--
-- 元データ (597曲) は 2000-2009 年代が 40% を占め、2020+ は 8% しかない
-- という強い偏りがある。素直にランダムサンプリングすると古い曲が支配する。
--
-- アプローチ: Inverse Propensity Weighting (逆確率重み付け)
--   各バケットに目標%を設定し、
--     重み = 目標% / 候補曲数
--   として重み付きランダムサンプリング。これにより、サンプルされた集合の
--   バケット分布が目標分布に一致する(数学的に保証される)。
--
-- 目標分布 (Phase 1, ハードコード):
--   2020年〜:    30%
--   2015〜2019:  25%
--   2010〜2014:  20%
--   2000〜2009:  15%
--   〜1999:      10%
--
-- 数学的性質:
--   バケット b 内の任意の曲 i が選ばれる確率
--     ∝  weight_i  =  target_pct[b] / count[b]
--   バケット b 全体の選ばれる確率
--     ∝  count[b] * weight_i  =  target_pct[b]
--   → DB の各バケットの曲数(count)に関わらず、出力分布は target_pct 通り。
--
-- 将来拡張 (Phase 2 以降):
--   - bucket_targets CTE を user_preferences テーブルからの読み出しに差し替え
--     → ユーザー個別の年代好みに対応
--   - weighted CTE で「お気に入りアーティスト」のブースト乗算
--     → 例: weight *= case when artist in (favs) then 1.5 else 1 end
--   - 年代バケット境界(2020/2015/2010/2000)を引数化
--   いずれも他の SQL 構造を変えずに、特定 CTE の差し替えだけで実装可能。
-- ============================================================================

create or replace function public.get_unrated_songs(
  p_limit           int     default 20,
  p_popular_only    boolean default false
)
returns setof public.songs
language sql
stable
security invoker
as $$
  with
  -- 1. 未評価候補曲 + 年代バケットラベル付け
  candidates as (
    select s.id,
      case
        when s.release_year >= 2020 then '2020s+'
        when s.release_year >= 2015 then '2015-2019'
        when s.release_year >= 2010 then '2010-2014'
        when s.release_year >= 2000 then '2000-2009'
        else                              'pre-2000'
      end as bucket
    from public.songs s
    where not exists (
      select 1
      from public.evaluations e
      where e.user_id = auth.uid()
        and e.song_id = s.id
    )
      and (p_popular_only = false or s.is_popular = true)
  ),

  -- 2. バケット毎の候補曲数(評価済みは除外済み)
  bucket_counts as (
    select bucket, count(*) as cnt
    from candidates
    group by bucket
  ),

  -- 3. 目標分布(Phase 1: ハードコード)
  --    Phase 2 で user_preferences テーブルからの読み出しに差し替え予定
  bucket_targets(bucket, target_pct) as (
    values
      ('2020s+',     0.30::double precision),
      ('2015-2019',  0.25::double precision),
      ('2010-2014',  0.20::double precision),
      ('2000-2009',  0.15::double precision),
      ('pre-2000',   0.10::double precision)
  ),

  -- 4. 各候補曲の重み = 目標% / 候補曲数
  --    候補が 0 のバケットは bucket_counts に出ないので join で自動除外
  weighted as (
    select c.id,
      bt.target_pct / bc.cnt::double precision as weight
    from candidates c
    join bucket_counts  bc using (bucket)
    join bucket_targets bt using (bucket)
  )

  -- 5. 重み付きランダムで p_limit 曲を選び、デッキ内はランダム順に並べる
  --    (順序が重みに依存するとデッキの最初が常に新曲になる体感を回避)
  select s.*
  from public.songs s
  where s.id in (
    select id
    from weighted
    order by random() * weight desc
    limit p_limit
  )
  order by random();
$$;

-- 権限再付与(create or replace で稀に剥がれるケースに備えて)
grant execute on function public.get_unrated_songs to authenticated;

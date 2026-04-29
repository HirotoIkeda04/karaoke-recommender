-- ============================================================================
-- get_unrated_songs_v2 を超シンプルなロジックに置き換え (デバッグ用)
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 021 まで実行済み
--
-- 背景:
--   015〜021 で重み計算ロジックを段階的に高度化したが、
--   ユーザー側で演歌が出続ける現象が解決しない。
--   SQL 直接実行では正しい結果が返るのに、アプリで演歌が出る。
--   関数の複雑さが原因か検証するため、最小限のロジックに置き換える。
--
-- 新ロジック:
--   1. enka_kayo タグを含む曲を除外
--   2. j_pop / j_rock / anison / vocaloid_utaite / idol_male / idol_female /
--      rnb_soul / hiphop / kpop のいずれかを含む曲を候補に
--   3. ランダム順で limit 件返す
--
-- ※ 年代分布、ジャンル重み、artist_boost、ユーザー嗜好は一切なし。
--   これで演歌が消えたら「複雑なロジックのどこかに見落としていたバグ」確定。
--   消えなければ「DB と app の間の経路に問題」確定。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_unrated_songs_v2(
  p_limit        int     default 20,
  p_popular_only boolean default false
) returns setof public.songs
language sql
stable
security invoker
as $$
  select s.*
  from public.songs s
  left join public.artists a on a.id = s.artist_id
  where not exists (
    select 1 from public.evaluations e
    where e.user_id = auth.uid() and e.song_id = s.id
  )
    and (p_popular_only = false or s.is_popular = true)
    -- enka_kayo タグを含む曲は除外 (純粋演歌も dual-tagged も)
    and not (
      coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[])
      @> array['enka_kayo']
    )
    -- 候補ジャンルのいずれかを含むこと
    and (
      coalesce(nullif(s.genres, '{}'::text[]), a.genres, '{}'::text[])
      && array['j_pop','j_rock','anison','vocaloid_utaite',
               'idol_male','idol_female','rnb_soul','hiphop','kpop']
    )
  order by random()
  limit p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.get_unrated_songs_v2 TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

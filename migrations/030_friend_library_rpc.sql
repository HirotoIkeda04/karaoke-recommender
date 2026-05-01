-- ============================================================================
-- フレンドのライブラリ閲覧用 RPC (プロフィール / 評価リスト)
-- ============================================================================
-- 用途:
--   /u/[userId] でフレンドの評価ライブラリを閲覧する。
--
-- なぜ RPC か:
--   evaluations / profiles / user_voice_estimate などの RLS は「自分の分のみ」。
--   フレンド間で公開する条件 (accepted) を SECURITY DEFINER 関数内で検証し、
--   関数経由でのみ薄く公開する。RLS そのものは緩めない。
--
-- フレンド成立判定:
--   friendships.status = 'accepted' で双方向に登録済みであること。
--   (テーブル制約により a < b で 1 行のみ存在)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- get_friend_library_profile
-- ---------------------------------------------------------------------------
-- フレンドのライブラリ画面ヘッダーに必要なメタ情報をまとめて返す。
-- フレンドでない場合は 0 行を返す (UI 側で 403 風画面に切替)。
-- ---------------------------------------------------------------------------
create or replace function public.get_friend_library_profile(p_friend_id uuid)
returns table (
  display_name              text,
  friend_count              int,
  rated_song_count          int,
  voice_comfortable_min_midi int,
  voice_comfortable_max_midi int,
  voice_falsetto_max_midi    int,
  voice_easy_count           int,
  era_buckets               jsonb,
  genre_buckets             jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_friend boolean;
begin
  if v_caller is null then
    return;
  end if;

  select exists(
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.user_a_id = v_caller and f.user_b_id = p_friend_id) or
        (f.user_b_id = v_caller and f.user_a_id = p_friend_id)
      )
  ) into v_is_friend;

  if not v_is_friend then
    return;
  end if;

  return query
  select
    p.display_name,
    (select count(*)::int from public.friendships f
       where f.status = 'accepted'
         and (f.user_a_id = p_friend_id or f.user_b_id = p_friend_id)),
    (select count(*)::int from public.evaluations e where e.user_id = p_friend_id),
    -- view 側は percentile_cont による double precision / count による bigint を返すので
    -- returns table の int 宣言と噛み合うよう明示的にキャストする。
    round(ve.comfortable_min_midi)::int,
    round(ve.comfortable_max_midi)::int,
    ve.falsetto_max_midi::int,
    ve.easy_count::int,
    coalesce((
      select jsonb_object_agg(decade::text, cnt)
      from (
        select (floor(s.release_year::numeric / 10) * 10)::int as decade,
               count(*)::int as cnt
        from public.evaluations e
        join public.songs s on s.id = e.song_id
        where e.user_id = p_friend_id and s.release_year is not null
        group by 1
      ) era
    ), '{}'::jsonb),
    coalesce((
      select jsonb_object_agg(g.genre, g.song_count)
      from public.user_genre_distribution g
      where g.user_id = p_friend_id
    ), '{}'::jsonb)
  from public.profiles p
  left join public.user_voice_estimate ve on ve.user_id = p_friend_id
  where p.id = p_friend_id;
end;
$$;

grant execute on function public.get_friend_library_profile(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- get_friend_library_evaluations
-- ---------------------------------------------------------------------------
-- フレンドの評価行 (rating + 曲メタ) を返す。並びは updated_at desc。
-- フレンドでない場合は 0 行を返す。
-- ---------------------------------------------------------------------------
create or replace function public.get_friend_library_evaluations(p_friend_id uuid)
returns table (
  rating                  public.rating_type,
  updated_at              timestamptz,
  song_id                 uuid,
  song_title              text,
  song_artist             text,
  song_release_year       int,
  song_range_low_midi     int,
  song_range_high_midi    int,
  song_falsetto_max_midi  int,
  song_image_url_small    text,
  song_image_url_medium   text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_is_friend boolean;
begin
  if v_caller is null then
    return;
  end if;

  select exists(
    select 1 from public.friendships f
    where f.status = 'accepted'
      and (
        (f.user_a_id = v_caller and f.user_b_id = p_friend_id) or
        (f.user_b_id = v_caller and f.user_a_id = p_friend_id)
      )
  ) into v_is_friend;

  if not v_is_friend then
    return;
  end if;

  return query
  select
    e.rating,
    e.updated_at,
    s.id,
    s.title,
    s.artist,
    s.release_year,
    s.range_low_midi,
    s.range_high_midi,
    s.falsetto_max_midi,
    s.image_url_small,
    s.image_url_medium
  from public.evaluations e
  join public.songs s on s.id = e.song_id
  where e.user_id = p_friend_id
  order by e.updated_at desc;
end;
$$;

grant execute on function public.get_friend_library_evaluations(uuid) to authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

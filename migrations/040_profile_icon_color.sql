-- ============================================================================
-- profiles.icon_color: ユーザーが選択したアイコンの背景色
-- ============================================================================
-- 値の形式: '#RRGGBB' の小文字 7 文字 (固定パレットから選択)。
-- NULL は「未設定」(クライアント側で既定色にフォールバック)。
-- ============================================================================

alter table public.profiles
  add column if not exists icon_color text
    check (icon_color is null or icon_color ~ '^#[0-9a-f]{6}$');

-- フレンドのライブラリ閲覧 RPC が icon_color も返すように差し替える。
-- 030 の get_friend_library_profile に列を 1 つ追加するだけだが、
-- returns table の列構成を変える場合 create or replace では弾かれるため、
-- 一度 drop してから作り直す。
drop function if exists public.get_friend_library_profile(uuid);

create or replace function public.get_friend_library_profile(p_friend_id uuid)
returns table (
  display_name              text,
  icon_color                text,
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
    p.icon_color,
    (select count(*)::int from public.friendships f
       where f.status = 'accepted'
         and (f.user_a_id = p_friend_id or f.user_b_id = p_friend_id)),
    (select count(*)::int from public.evaluations e where e.user_id = p_friend_id),
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

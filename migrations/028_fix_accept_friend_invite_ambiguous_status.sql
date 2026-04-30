-- ============================================================================
-- accept_friend_invite の "column reference 'status' is ambiguous" 修正
-- ============================================================================
-- 原因:
--   返却テーブル `returns table (status text, friend_id uuid)` が暗黙の
--   OUT 変数 `status` を生成し、関数内の friendships.status カラム参照と
--   名前衝突していた。
-- 対処:
--   friendships.status を明示的にテーブル修飾。
-- ============================================================================

create or replace function public.accept_friend_invite(p_token text)
returns table (
  status    text,
  friend_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
  v_expires_at timestamptz;
  v_me         uuid := auth.uid();
  v_a          uuid;
  v_b          uuid;
begin
  if v_me is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select fil.creator_id, fil.expires_at
    into v_creator_id, v_expires_at
  from public.friend_invite_links fil
  where fil.token = p_token;

  if v_creator_id is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_expires_at <= now() then
    return query select 'expired'::text, null::uuid;
    return;
  end if;

  if v_creator_id = v_me then
    return query select 'self'::text, v_creator_id;
    return;
  end if;

  if v_me < v_creator_id then
    v_a := v_me; v_b := v_creator_id;
  else
    v_a := v_creator_id; v_b := v_me;
  end if;

  if exists (
    select 1 from public.friendships f
    where f.user_a_id = v_a
      and f.user_b_id = v_b
      and f.status = 'accepted'
  ) then
    return query select 'already_friends'::text, v_creator_id;
    return;
  end if;

  insert into public.friendships
    (user_a_id, user_b_id, status, requested_by_id, accepted_at)
  values
    (v_a, v_b, 'accepted', v_creator_id, now())
  on conflict (user_a_id, user_b_id) do update
    set status      = 'accepted',
        accepted_at = coalesce(public.friendships.accepted_at, now());

  return query select 'created'::text, v_creator_id;
end;
$$;

grant execute on function public.accept_friend_invite(text) to authenticated;

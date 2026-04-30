-- ============================================================================
-- 友達がアクティブに開いているルーム一覧 RPC
-- ============================================================================
-- 用途: /rooms 画面で「フレンドが今カラオケしている」を表示する。
--
-- なぜ RPC か:
--   public.rooms の RLS は「creator または参加者のみ閲覧可」。
--   フレンドであっても参加していなければ rooms 行は SELECT できない。
--   security definer 経由で「フレンドの未終了ルーム」だけを返す薄い窓を開ける。
--
-- 返却:
--   各ルーム 1 行。creator_name はフレンドの display_name。
--   participant_count はアクティブ参加者数 (left_at is null)。
-- ============================================================================

create or replace function public.get_friend_active_rooms()
returns table (
  room_id           uuid,
  creator_id        uuid,
  creator_name      text,
  qr_token          text,
  qr_expires_at     timestamptz,
  created_at        timestamptz,
  participant_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select auth.uid() as id
  ),
  my_friends as (
    select case
      when f.user_a_id = (select id from me) then f.user_b_id
      else f.user_a_id
    end as friend_id
    from public.friendships f, me
    where f.status = 'accepted'
      and me.id in (f.user_a_id, f.user_b_id)
  )
  select
    r.id,
    r.creator_id,
    p.display_name,
    r.qr_token,
    r.qr_expires_at,
    r.created_at,
    coalesce((
      select count(*)::int
      from public.room_participants rp
      where rp.room_id = r.id and rp.left_at is null
    ), 0)
  from public.rooms r
  join my_friends mf on mf.friend_id = r.creator_id
  join public.profiles p on p.id = r.creator_id
  where r.ended_at is null
  order by r.created_at desc;
$$;

grant execute on function public.get_friend_active_rooms() to authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

-- ============================================================================
-- ゲスト用ルーム状態取得 RPC
-- ============================================================================
-- 認証ユーザーは PostgREST + RLS でルーム情報を直接クエリできるが、
-- ゲストは auth.uid() を持たないため RLS が効かない。
-- このため security definer 関数で「guest_token が一致するゲスト」が
-- ルーム情報を取れるようにする。
--
-- 認証ユーザーから呼ばれた場合も同じ関数が使えるよう、両方を扱う。
-- ============================================================================


create or replace function public.get_room_state(
  p_qr_token   text,
  p_guest_token text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_room          public.rooms%rowtype;
  v_user_id       uuid := auth.uid();
  v_authorized    boolean;
  v_participants  jsonb;
  v_repertoire    jsonb;
  v_total_users   int;
begin
  select * into v_room from public.rooms where qr_token = p_qr_token;

  if v_room.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_room.ended_at is not null then
    return jsonb_build_object('status', 'ended', 'room_id', v_room.id);
  end if;

  -- 認可チェック
  if v_user_id is not null then
    v_authorized := v_room.creator_id = v_user_id
      or exists (
        select 1 from public.room_participants
        where room_id = v_room.id and user_id = v_user_id
      );
  elsif p_guest_token is not null then
    v_authorized := exists (
      select 1 from public.room_participants
      where room_id = v_room.id and guest_token = p_guest_token
    );
  else
    v_authorized := false;
  end if;

  if not v_authorized then
    return jsonb_build_object('status', 'unauthorized');
  end if;

  -- アクティブ参加者 (left_at is null)、creator を先頭に並べる
  select jsonb_agg(
    jsonb_build_object(
      'id',         rp.id,
      'name',       case
                      when rp.user_id is not null then p.display_name
                      else rp.guest_name
                    end,
      'is_user',    rp.user_id is not null,
      'is_creator', rp.user_id = v_room.creator_id
    )
    order by
      case when rp.user_id = v_room.creator_id then 0 else 1 end,
      rp.joined_at
  )
  into v_participants
  from public.room_participants rp
  left join public.profiles p on p.id = rp.user_id
  where rp.room_id = v_room.id and rp.left_at is null;

  -- 認証ユーザー参加者数 (レパートリーの分母)
  select count(*) into v_total_users
  from public.room_participants
  where room_id = v_room.id and left_at is null and user_id is not null;

  -- マージ済レパートリー (easy/medium のみ集計)
  select jsonb_agg(item)
  into v_repertoire
  from (
    select jsonb_build_object(
      'song_id',      s.id,
      'title',        s.title,
      'artist',       s.artist,
      'image_url',    s.image_url_medium,
      'singer_ids',   array_agg(distinct e.user_id),
      'singer_count', count(distinct e.user_id)::int
    ) as item
    from public.evaluations e
    join public.songs s on s.id = e.song_id
    where e.user_id in (
      select user_id from public.room_participants
      where room_id = v_room.id and left_at is null and user_id is not null
    )
      and e.rating in ('easy', 'medium')
    group by s.id
    order by count(distinct e.user_id) desc
  ) sub;

  return jsonb_build_object(
    'status',         'ok',
    'room_id',        v_room.id,
    'creator_id',     v_room.creator_id,
    'qr_expires_at',  v_room.qr_expires_at,
    'qr_token',       v_room.qr_token,
    'is_creator',     v_user_id = v_room.creator_id,
    'is_guest',       v_user_id is null,
    'total_users',    v_total_users,
    'participants',   coalesce(v_participants, '[]'::jsonb),
    'repertoire',     coalesce(v_repertoire, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_room_state(text, text)
  to anon, authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

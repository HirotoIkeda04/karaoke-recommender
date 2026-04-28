-- ============================================================================
-- フレンド機能 + ルーム共有機能
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法:
--   1. Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--   2. または `supabase db push` (Supabase CLI 使用時)
--
-- 含まれるもの:
--   1. public.profiles        : アプリ用プロフィール (display_name のみ)
--   2. public.friendships     : 双方向友達関係 (a < b で正規化)
--   3. public.friend_invite_links : 期限付き複数人OK の招待リンク (7日)
--   4. public.rooms           : カラオケセッション
--   5. public.room_participants : ルーム参加者 (認証ユーザー or ゲスト)
--   6. RPC                    : 招待リンク承諾 / ルーム参加 (ゲスト含む)
--   7. メンテ関数             : 自動終了 / 90日削除 / 期限切れ削除
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. public.profiles (アプリ用プロフィール)
-- ----------------------------------------------------------------------------
-- ※ Supabase の auth.users (認証) と紛らわしいため、アプリ側は profiles 命名。
-- 個人情報最小化方針:
--   - auth.users (Supabase 管理) には Google sub + email が入る
--   - public.profiles にはユーザー指定の display_name のみ
--   - メアド/本名/写真は意図的に保持しない
--   - 漏洩しても「ニックネーム + UUID + 評価データ」しか出ない設計

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null
    check (length(trim(display_name)) > 0 and length(display_name) <= 32),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- 新規 OAuth ログイン時に自動でプロフィール行を作る
-- 仮の display_name を UUID 先頭 4 桁から生成 (例: "ユーザー A3F2")
-- 初回ログイン後の画面で表示名の上書きを必須にする想定
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'ユーザー ' || upper(substr(new.id::text, 1, 4)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ----------------------------------------------------------------------------
-- 2. friendships (双方向友達関係)
-- ----------------------------------------------------------------------------
-- 正規化: 必ず user_a_id < user_b_id で保存し、(a, b) と (b, a) の二重を防ぐ。
-- status:
--   pending  = 申請中 (画面上の申請フローから。リンク経由は即 accepted で入る)
--   accepted = 友達

create table if not exists public.friendships (
  user_a_id       uuid not null references public.profiles(id) on delete cascade,
  user_b_id       uuid not null references public.profiles(id) on delete cascade,
  status          text not null check (status in ('pending', 'accepted')),
  requested_by_id uuid not null references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  accepted_at     timestamptz,
  primary key (user_a_id, user_b_id),
  check (user_a_id < user_b_id),
  check (requested_by_id in (user_a_id, user_b_id))
);

create index if not exists idx_friendships_user_a on public.friendships (user_a_id);
create index if not exists idx_friendships_user_b on public.friendships (user_b_id);


-- ----------------------------------------------------------------------------
-- 3. friend_invite_links (期限付き複数人OK の招待リンク)
-- ----------------------------------------------------------------------------
-- token は URL-safe な乱数 (アプリ層で crypto.randomBytes して base64url)
-- 複数人が同じリンクで申請できる (「複数人OK + 期限あり」方針)
-- デフォルト期限は 7日 (アプリ側で expires_at を計算してセット)

create table if not exists public.friend_invite_links (
  token       text primary key,
  creator_id  uuid not null references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_friend_invite_links_creator
  on public.friend_invite_links (creator_id);


-- ----------------------------------------------------------------------------
-- 4. rooms (カラオケセッション)
-- ----------------------------------------------------------------------------
-- 「ホスト」概念は最小化: creator は履歴帰属のためだけに記録する。
-- ルーム自体は creator が居なくても存続。
-- 終了条件:
--   - last_activity_at から 30分経過 (auto_end_idle_rooms)
--   - created_at から 8時間経過 (同上、強制タイムアウト)
--   - creator が明示的に ended_at をセット
-- QR は qr_token で識別、有効期限 30分。creator が再生成可能。

create table if not exists public.rooms (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.profiles(id) on delete cascade,
  qr_token          text not null unique,
  qr_expires_at     timestamptz not null,
  last_activity_at  timestamptz not null default now(),
  ended_at          timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_rooms_creator
  on public.rooms (creator_id, created_at desc);
create index if not exists idx_rooms_qr_token
  on public.rooms (qr_token);


-- ----------------------------------------------------------------------------
-- 5. room_participants (ルーム参加者)
-- ----------------------------------------------------------------------------
-- 認証ユーザー: user_id をセット、guest_* は NULL
-- ゲスト:       user_id NULL、guest_name + guest_token をセット
--               guest_token はゲストの再入室用 (アプリ層で localStorage に保存)

create table if not exists public.room_participants (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete cascade,
  guest_name  text,
  guest_token text,
  joined_at   timestamptz not null default now(),
  left_at     timestamptz,

  -- ユーザー or ゲストの一方のみ
  check (
    (user_id is not null and guest_name is null and guest_token is null)
    or (user_id is null and guest_name is not null and guest_token is not null)
  ),
  check (guest_name is null or
         (length(trim(guest_name)) > 0 and length(guest_name) <= 32))
);

create unique index if not exists uq_room_participants_user
  on public.room_participants (room_id, user_id)
  where user_id is not null;

create unique index if not exists uq_room_participants_guest
  on public.room_participants (room_id, guest_token)
  where guest_token is not null;

create index if not exists idx_room_participants_user
  on public.room_participants (user_id, joined_at desc)
  where user_id is not null;

-- 参加者の動きで last_activity_at を更新 (アイドルタイムアウト判定用)
create or replace function public.touch_room_activity()
returns trigger
language plpgsql
as $$
begin
  update public.rooms set last_activity_at = now()
    where id = coalesce(new.room_id, old.room_id);
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_room_activity on public.room_participants;
create trigger trg_room_activity
  after insert or update or delete on public.room_participants
  for each row execute function public.touch_room_activity();


-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------

-- ---- profiles ------------------------------------------------------
alter table public.profiles enable row level security;

-- 認証ユーザーは display_name を読める
-- (友達/ルーム参加者表示で必要。display_name 以外の個人情報を持たないので OK)
drop policy if exists "Authenticated can view profiles" on public.profiles;
create policy "Authenticated can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
-- INSERT/DELETE は trigger と cascade に任せる (直接禁止)


-- ---- friendships ---------------------------------------------------
alter table public.friendships enable row level security;

drop policy if exists "Users can view own friendships" on public.friendships;
create policy "Users can view own friendships"
  on public.friendships for select
  using (auth.uid() in (user_a_id, user_b_id));

-- 自分が依頼者として申請のみ INSERT 可
drop policy if exists "Users can create friendship requests" on public.friendships;
create policy "Users can create friendship requests"
  on public.friendships for insert
  with check (
    requested_by_id = auth.uid()
    and auth.uid() in (user_a_id, user_b_id)
    and status = 'pending'
  );

-- 相手からの pending 申請を承認 (自分が「依頼者でない」側のみ可)
drop policy if exists "Users can accept incoming requests" on public.friendships;
create policy "Users can accept incoming requests"
  on public.friendships for update
  using (
    auth.uid() in (user_a_id, user_b_id)
    and auth.uid() <> requested_by_id
  )
  with check (
    auth.uid() in (user_a_id, user_b_id)
    and status = 'accepted'
  );

drop policy if exists "Users can delete own friendships" on public.friendships;
create policy "Users can delete own friendships"
  on public.friendships for delete
  using (auth.uid() in (user_a_id, user_b_id));


-- ---- friend_invite_links -------------------------------------------
alter table public.friend_invite_links enable row level security;

-- 自分が作ったリンクのみ管理可
drop policy if exists "Users can view own invite links" on public.friend_invite_links;
create policy "Users can view own invite links"
  on public.friend_invite_links for select
  using (auth.uid() = creator_id);

drop policy if exists "Users can create own invite links" on public.friend_invite_links;
create policy "Users can create own invite links"
  on public.friend_invite_links for insert
  with check (auth.uid() = creator_id);

drop policy if exists "Users can delete own invite links" on public.friend_invite_links;
create policy "Users can delete own invite links"
  on public.friend_invite_links for delete
  using (auth.uid() = creator_id);
-- ※ token を使った lookup は RPC (security definer) 経由で anon にも許可


-- ---- rooms ---------------------------------------------------------
alter table public.rooms enable row level security;

drop policy if exists "Participants can view rooms" on public.rooms;
create policy "Participants can view rooms"
  on public.rooms for select
  using (
    auth.uid() = creator_id
    or exists (
      select 1 from public.room_participants rp
      where rp.room_id = rooms.id and rp.user_id = auth.uid()
    )
  );

drop policy if exists "Users can create rooms" on public.rooms;
create policy "Users can create rooms"
  on public.rooms for insert
  with check (auth.uid() = creator_id);

-- creator のみ更新可 (QR 再生成、終了)
drop policy if exists "Creator can update room" on public.rooms;
create policy "Creator can update room"
  on public.rooms for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);


-- ---- room_participants ---------------------------------------------
alter table public.room_participants enable row level security;

-- 同じルームの参加者全員を閲覧可 (creator も含む)
drop policy if exists "Co-participants can view" on public.room_participants;
create policy "Co-participants can view"
  on public.room_participants for select
  using (
    exists (
      select 1 from public.room_participants me
      where me.room_id = room_participants.room_id
        and me.user_id = auth.uid()
    )
    or exists (
      select 1 from public.rooms r
      where r.id = room_participants.room_id
        and r.creator_id = auth.uid()
    )
  );

-- 認証ユーザーは自分の参加レコードのみ INSERT 可
-- ゲスト参加は join_room_by_qr RPC (security definer) 経由
drop policy if exists "Users can join rooms" on public.room_participants;
create policy "Users can join rooms"
  on public.room_participants for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own participation" on public.room_participants;
create policy "Users can update own participation"
  on public.room_participants for update
  using (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 7. RPC: 招待リンクの公開情報を取得 (anon 可)
-- ----------------------------------------------------------------------------
-- /friend/[token] の着地ページで「○○ さんからの申請」を表示するため。
-- 未ログインの状態でも inviter の display_name を見られる必要がある。

create or replace function public.get_friend_invite_info(p_token text)
returns table (
  creator_id   uuid,
  creator_name text,
  expires_at   timestamptz,
  is_valid     boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    fil.creator_id,
    u.display_name,
    fil.expires_at,
    fil.expires_at > now()
  from public.friend_invite_links fil
  join public.profiles u on u.id = fil.creator_id
  where fil.token = p_token;
$$;

grant execute on function public.get_friend_invite_info(text) to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 8. RPC: 招待リンクからフレンド成立 (認証必須)
-- ----------------------------------------------------------------------------
-- 戻り status:
--   created         : フレンド成立
--   already_friends : 既にフレンド (no-op)
--   self            : 自分自身のリンク (no-op)
--   expired         : 期限切れ
--   invalid         : token 不正 or 未認証

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

  -- 正規化 (a < b)
  if v_me < v_creator_id then
    v_a := v_me; v_b := v_creator_id;
  else
    v_a := v_creator_id; v_b := v_me;
  end if;

  if exists (
    select 1 from public.friendships
    where user_a_id = v_a and user_b_id = v_b and status = 'accepted'
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


-- ----------------------------------------------------------------------------
-- 9. RPC: ルーム参加 (認証ユーザー / ゲスト両対応, anon 可)
-- ----------------------------------------------------------------------------
-- 引数:
--   p_qr_token    : ルームの QR トークン
--   p_guest_name  : ゲスト初回参加時の表示名 (認証ユーザー時は無視)
--   p_guest_token : ゲスト再入室時の token (認証ユーザー時は無視)
-- 戻り status:
--   joined_user   : 認証ユーザーが新規参加
--   joined_guest  : ゲストが新規参加 (guest_token 発行)
--   rejoined      : 既存参加者の再入室 (left_at をクリア)
--   expired       : QR の有効期限切れ
--   ended         : ルームが終了済み
--   invalid       : QR 不正 or ゲスト名空 or guest_token 不一致

create or replace function public.join_room_by_qr(
  p_qr_token   text,
  p_guest_name text default null,
  p_guest_token text default null
)
returns table (
  room_id        uuid,
  participant_id uuid,
  guest_token    text,
  status         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room      public.rooms%rowtype;
  v_me        uuid := auth.uid();
  v_pid       uuid;
  v_token     text;
  v_existing  public.room_participants%rowtype;
begin
  select * into v_room from public.rooms where qr_token = p_qr_token;

  if v_room.id is null then
    return query select null::uuid, null::uuid, null::text, 'invalid'::text;
    return;
  end if;

  if v_room.ended_at is not null then
    return query select v_room.id, null::uuid, null::text, 'ended'::text;
    return;
  end if;

  if v_room.qr_expires_at <= now() then
    return query select v_room.id, null::uuid, null::text, 'expired'::text;
    return;
  end if;

  -- ===== 認証ユーザー =====
  if v_me is not null then
    select * into v_existing from public.room_participants
      where room_id = v_room.id and user_id = v_me;

    if v_existing.id is not null then
      update public.room_participants
        set left_at = null
        where id = v_existing.id;
      return query select v_room.id, v_existing.id, null::text, 'rejoined'::text;
      return;
    end if;

    insert into public.room_participants (room_id, user_id)
    values (v_room.id, v_me)
    returning id into v_pid;
    return query select v_room.id, v_pid, null::text, 'joined_user'::text;
    return;
  end if;

  -- ===== ゲスト (再入室) =====
  if p_guest_token is not null then
    select * into v_existing from public.room_participants
      where room_id = v_room.id and room_participants.guest_token = p_guest_token;

    if v_existing.id is null then
      return query select v_room.id, null::uuid, null::text, 'invalid'::text;
      return;
    end if;

    update public.room_participants set left_at = null where id = v_existing.id;
    return query select v_room.id, v_existing.id, p_guest_token, 'rejoined'::text;
    return;
  end if;

  -- ===== ゲスト (新規) =====
  if p_guest_name is null or length(trim(p_guest_name)) = 0 then
    return query select v_room.id, null::uuid, null::text, 'invalid'::text;
    return;
  end if;

  -- URL-safe な乱数 token を発行 (24 byte → base64url)
  v_token := translate(
    encode(gen_random_bytes(24), 'base64'),
    '+/=', '-_'
  );
  v_token := replace(v_token, '_', '');  -- '=' を消すための簡略化
  -- ↑ 簡易実装。重複チェック込みでの再試行はしない (24 byte なら衝突確率は無視可)

  insert into public.room_participants (room_id, guest_name, guest_token)
  values (v_room.id, trim(p_guest_name), v_token)
  returning id into v_pid;
  return query select v_room.id, v_pid, v_token, 'joined_guest'::text;
end;
$$;

grant execute on function public.join_room_by_qr(text, text, text)
  to anon, authenticated;


-- ----------------------------------------------------------------------------
-- 10. メンテナンス関数
-- ----------------------------------------------------------------------------

-- 全員退出から30分 or 作成から8時間で ended_at を打つ
create or replace function public.auto_end_idle_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  update public.rooms
  set ended_at = now()
  where ended_at is null
    and (
      created_at < now() - interval '8 hours'
      or last_activity_at < now() - interval '30 minutes'
    );
$$;

-- 90日経過したルームを物理削除 (履歴は直近3件のみ表示する設計のため)
create or replace function public.cleanup_old_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms where created_at < now() - interval '90 days';
$$;

-- 期限切れの招待リンクを削除 (期限後7日でクリーンアップ)
create or replace function public.cleanup_expired_invite_links()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.friend_invite_links
  where expires_at < now() - interval '7 days';
$$;

-- ※ pg_cron で定期実行を設定すること (Supabase ダッシュボード > Database > Extensions で有効化後):
--   select cron.schedule('auto-end-idle-rooms',
--     '*/5 * * * *', 'select public.auto_end_idle_rooms()');
--   select cron.schedule('cleanup-old-rooms',
--     '0 3 * * *', 'select public.cleanup_old_rooms()');
--   select cron.schedule('cleanup-expired-invite-links',
--     '0 3 * * *', 'select public.cleanup_expired_invite_links()');


-- ----------------------------------------------------------------------------
-- 11. 権限付与
-- ----------------------------------------------------------------------------

grant select, update on public.profiles                      to authenticated;
grant select, insert, update, delete on public.friendships to authenticated;
grant select, insert, delete on public.friend_invite_links to authenticated;
grant select, insert, update on public.rooms              to authenticated;
grant select, insert, update on public.room_participants  to authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

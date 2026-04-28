-- ============================================================================
-- room_participants / rooms RLS の無限再帰を修正
-- ============================================================================
-- 問題:
--   migration 007 で room_participants の SELECT ポリシーが
--   "同じ room の participants に自分が居るか" を EXISTS で確認していたが、
--   その EXISTS subquery 自体に再び room_participants の RLS が適用されて
--   infinite recursion 発生。
--
--   ERROR: 42P17: infinite recursion detected in policy for relation
--          "room_participants"
--
-- 解決:
--   SECURITY DEFINER の helper 関数で RLS を 1 段階バイパスする。
--   関数は所有者 (postgres) 権限で実行されるため、関数内のクエリには
--   呼び出し元の RLS が適用されない (Postgres の標準的なパターン)。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 参加判定ヘルパ関数
-- ----------------------------------------------------------------------------
-- 「指定ユーザーが指定ルームに参加しているか」を返す。
-- left_at の有無は問わない (一度参加した人はルームを閲覧可能とする)。

create or replace function public.is_room_participant(
  p_room_id uuid,
  p_user_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.room_participants
    where room_id = p_room_id
      and user_id = p_user_id
  );
$$;

grant execute on function public.is_room_participant(uuid, uuid)
  to authenticated;


-- ----------------------------------------------------------------------------
-- 2. room_participants SELECT ポリシー差し替え
-- ----------------------------------------------------------------------------

drop policy if exists "Co-participants can view" on public.room_participants;
create policy "Co-participants can view"
  on public.room_participants for select
  using (
    -- 自分の参加レコード
    auth.uid() = user_id
    -- 同じルームに自分が居る (SECURITY DEFINER で再帰回避)
    or public.is_room_participant(room_id, auth.uid())
    -- そのルームの creator
    or exists (
      select 1 from public.rooms r
      where r.id = room_participants.room_id
        and r.creator_id = auth.uid()
    )
  );


-- ----------------------------------------------------------------------------
-- 3. rooms SELECT ポリシーも同関数経由に差し替え
-- ----------------------------------------------------------------------------
-- migration 007 の rooms ポリシーは room_participants を直接 EXISTS していた。
-- room_participants 側を修正したので、rooms 側からの subquery は再帰しないが、
-- 同じ helper を使うことで RLS チェック対象が 1 段減ってパフォーマンス改善 +
-- 一貫性向上。

drop policy if exists "Participants can view rooms" on public.rooms;
create policy "Participants can view rooms"
  on public.rooms for select
  using (
    auth.uid() = creator_id
    or public.is_room_participant(id, auth.uid())
  );


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

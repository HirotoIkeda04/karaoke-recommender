-- ============================================================================
-- rooms.is_recurring: 「いつものルーム」フラグ
-- ============================================================================
-- true の場合は cleanup_old_rooms による 90 日自動削除の対象外。
-- ユーザーが特定のルームを「いつもの友達カラオケ」として保護できるようにする。
-- 終了済 (ended_at != null) のルームでも切り替え可能。
-- ============================================================================

alter table public.rooms
  add column if not exists is_recurring boolean not null default false;

-- cleanup_old_rooms() を更新: is_recurring = true は削除しない
create or replace function public.cleanup_old_rooms()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.rooms
  where created_at < now() - interval '90 days'
    and is_recurring = false;
$$;

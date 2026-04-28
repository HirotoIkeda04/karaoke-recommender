-- ============================================================================
-- 既存ユーザーの profiles 行を backfill
-- ============================================================================
-- 問題:
--   migration 007 で導入した handle_new_user トリガは auth.users への
--   INSERT 時にのみ発火する。migration 適用「前」に signup 済みのユーザーは
--   public.profiles に行が無く、display_name 更新が 0 行 UPDATE になり
--   サイレントに失敗する。
--
-- 解決:
--   auth.users にあって public.profiles に無いユーザーに対し、トリガと
--   同じ仮 display_name で profiles 行を作成する (一回限りの backfill)。
-- ============================================================================

insert into public.profiles (id, display_name)
select
  u.id,
  'ユーザー ' || upper(substr(u.id::text, 1, 4))
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

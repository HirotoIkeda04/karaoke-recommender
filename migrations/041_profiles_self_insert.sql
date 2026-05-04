-- ============================================================================
-- profiles に「自分自身の行のみ INSERT 可能」なポリシーを追加
-- ============================================================================
-- 経緯:
--   migration 007 では profiles の INSERT は trigger (handle_new_user) に
--   任せる前提で、ユーザー直の INSERT は禁止していた。
--   しかし古いアカウントなど trigger が走らずに profile 行が無いユーザーが
--   存在し、/profile/setup での upsert が permission denied になる。
--
-- 対応:
--   自分の auth.uid() = id の行に限り INSERT を許可する。これで upsert が
--   既存行 → UPDATE / 不在 → INSERT のどちらでも通るようになる。
-- ============================================================================

-- 1) テーブル GRANT に insert を追加。
--    007 では select/update のみ付与されており、INSERT は GRANT 段階で弾かれる。
grant insert on public.profiles to authenticated;

-- 2) RLS で「自分の行のみ INSERT 可」のポリシーを追加。
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

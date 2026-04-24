-- ============================================================================
-- service_role への明示 GRANT 付与
-- ============================================================================
-- 2026-04-25 検出: 新形式 API キー (sb_secret_...) を使うと
-- public.songs に対して 403 "permission denied for table songs" (SQLSTATE 42501)
-- が返される問題の修正。
--
-- 旧方式の JWT service_role キーはプロジェクト作成時の暗黙 GRANT で動いていたが、
-- 新方式では role に対する表/関数レベルの GRANT が自動で付与されないケースがある。
-- 以後の table 追加でも困らないよう default privileges も同時設定する。
-- ============================================================================

-- スキーマ使用権
grant usage on schema public to service_role;

-- 既存オブジェクトへの全権限
grant all privileges on all tables    in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute       on all functions  in schema public to service_role;

-- 今後 public に追加される table / sequence / function にも自動付与
alter default privileges in schema public
  grant all privileges on tables    to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute        on functions to service_role;

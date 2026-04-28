-- ============================================================================
-- artists テーブル / artists_with_song_count VIEW の認証ユーザー読み取り権限
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011 / 012 マイグレーション実行済み
--
-- 背景:
--   002_service_role_grants.sql は service_role のみ GRANT を与えていたため、
--   authenticated ロール (ブラウザの SSR クライアント) からは 011 で追加した
--   artists / 012 で追加した view が "permission denied" になる。
--
-- 方針:
--   - 読み取り (SELECT): authenticated に許可
--   - 書き込み (UPDATE/INSERT/DELETE): /admin/artists Server Action から
--     service_role 経由で実行するので追加 GRANT は不要
-- ============================================================================

grant select on public.artists                  to authenticated;
grant select on public.artists_with_song_count  to authenticated;

-- 今後 public スキーマに table/view を追加した場合も authenticated が SELECT
-- できるようにデフォルト権限を設定 (table のみ。view は default privileges 対象外)
alter default privileges in schema public
  grant select on tables to authenticated;

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

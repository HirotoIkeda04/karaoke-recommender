-- ============================================================================
-- profiles.icon_color: グラデーションプリセット (gradient:<id>) を許可する
-- ============================================================================
-- 040 で `^#[0-9a-f]{6}$` のみを許可していたが、icon_color に
-- aurora 等のグラデーションプリセット ID も保存できるよう check 制約を
-- 緩める。lib/icon-color.ts の gradientToken() と整合する形式
-- (`gradient:` + 英小文字/数字/_/- の英大文字なし) を許可する。
-- ============================================================================

alter table public.profiles
  drop constraint if exists profiles_icon_color_check;

alter table public.profiles
  add constraint profiles_icon_color_check
    check (
      icon_color is null
      or icon_color ~ '^#[0-9a-f]{6}$'
      or icon_color ~ '^gradient:[a-z0-9_-]+$'
    );

-- ============================================================================
-- songs.cert_score: RIAJ 認定レベル
-- ============================================================================
-- 背景:
--   fame_score (Wikipedia pageviews) は古いカラオケ定番曲を取りこぼす傾向がある。
--   特に「YouTube 普及前 (release < 2020)」の曲は MV の view 数が伸びない一方で、
--   CD 売上ベースの RIAJ 認定 (ゴールド/プラチナ/ミリオン/ダイヤモンド) があれば
--   「カラオケで歌われ続ける定番」を高い確度で判別できる。
--
--   PoC 結果 (scraper/output/poc_fame/report_v2.md):
--     - fame_score 単独: 全体 Spearman +0.151
--     - fame_score + cert_score: 全体 Spearman +0.278 (約 2 倍)
--     - 古典群 (release < 2020) で特に効果大
--
--   詳細な経緯は 2026-05-04 のセッションログを参照。
--
-- 列の意味:
--   cert_score      0..6 の整数。RIAJ 認定の最強レベル
--                   0 = 認定無し / 1=ゴールド / 2=プラチナ / 3=ダブルプラチナ
--                   4 = トリプルプラチナ / 5 = ミリオン (or ダイヤモンド)
--                   6 = マルチミリオン (3ミリオン以上)
--                   NULL = 未計算
--   cert_label      抽出された認定文字列 (例: "ミリオン", "ダブル・プラチナ")
--   cert_updated_at 最終バックフィル日時
--
-- 抽出元:
--   日本語 Wikipedia 記事の Certification フィールド + 記事末の認定テーブル。
--   (scraper/src/fetch_certifications.py)
--
-- 運用:
--   バックフィルは scripts/apply-cert-scores.ts から行う。
--   fame_score と同様、半年〜1年に一度の再計算が望ましい。
-- ============================================================================

alter table public.songs
  add column if not exists cert_score smallint,
  add column if not exists cert_label text,
  add column if not exists cert_updated_at timestamptz;

-- 古典曲フィルタで「認定保有曲のみ」を引くための部分インデックス
create index if not exists idx_songs_cert_score
  on public.songs (cert_score desc nulls last)
  where cert_score is not null and cert_score > 0;

comment on column public.songs.cert_score is
  'RIAJ 認定レベル (0..6)。0=なし / 1=ゴールド / 2=プラチナ / 3=ダブルプラチナ / '
  '4=トリプルプラチナ / 5=ミリオン or ダイヤモンド / 6=マルチミリオン。NULL=未計算。';
comment on column public.songs.cert_label is
  '認定の文字列 (例: "ミリオン", "ダブル・プラチナ")。デバッグ・表示用。';
comment on column public.songs.cert_updated_at is
  '最終バックフィル日時。';

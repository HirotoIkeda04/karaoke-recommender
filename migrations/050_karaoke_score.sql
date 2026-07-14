-- ============================================================================
-- songs.karaoke_score: 公式ランキング掲載実績から学習したカラオケ人気予測値
-- ============================================================================
-- 背景:
--   fame_score (日本語 Wikipedia 累積閲覧数) 単独ではカラオケ人気との相関が
--   弱いため、DAM / JOYSOUND の公式ランキング掲載実績を教師ラベルとして、
--   既存の曲メタデータからカラオケ人気を予測する。
--
-- 列の意味:
--   karaoke_score  LightGBM が出力したカラオケ人気の正規化予測値 (0..1)。
--                  NULL = 未計算。ランキングの順位・掲載有無そのものではない。
--
-- 運用:
--   scripts/export-karaoke-features.ts で特徴量を出力し、
--   scraper/src/karaoke_score/train.py でモデルを再学習・全曲を予測した後、
--   scripts/apply-karaoke-scores.ts で反映する。
--   ランキング取得結果は学習プロセスのメモリ内だけで扱い、保存しない。
--   ランキング母集団や既存メタデータが更新されたときに再計算する。
-- ============================================================================

alter table public.songs
  add column if not exists karaoke_score real;

create index if not exists idx_songs_karaoke_score
  on public.songs (karaoke_score desc nulls last);

comment on column public.songs.karaoke_score is
  'DAM / JOYSOUND 公式ランキング掲載実績を教師ラベルにした LightGBM の正規化予測値 (0..1)。NULL=未計算。ランキング順位・掲載有無そのものは保存しない。';

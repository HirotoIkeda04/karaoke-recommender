-- ============================================================================
-- Wikipedia Pageviews 由来の有名度スコア
-- ============================================================================
-- 背景:
--   recommender が「友達の前で歌っても場が白けない曲」を判断するためのシグナル。
--   日本語 Wikipedia の累計 pageviews を log10 で正規化したものを fame_score とする。
--
--   詳細な経緯と他ソース検討の議論は 2026-04-30 のセッションログを参照。
--   結論: Pageviews API は数値データのみを返すため著作権の対象外で、attribution
--   不要・商用 OK の唯一実用的な選択肢。
--
-- 列の意味:
--   fame_score      log10(fame_views), NULL=未計算, 0=記事なし。
--                   目安: >=5.0 超有名 / 4.0-5.0 有名 / 3.0-4.0 中堅 / <3.0 マイナー
--   fame_article    解決された Wikipedia 記事タイトル (canonical 形式)
--   fame_views      集計時点の 2015-07 以降の累計 pageviews
--   fame_updated_at バックフィル/再計算した最終時刻
--
-- 運用:
--   バックフィルは scripts/apply-fame-scores.ts から行う。
--   Wikipedia 側は記事生成・編集が常時起こるため、半年〜1年に一度の再計算が望ましい。
-- ============================================================================

alter table public.songs
  add column if not exists fame_score real,
  add column if not exists fame_article text,
  add column if not exists fame_views integer,
  add column if not exists fame_updated_at timestamptz;

-- recommender が「ORDER BY fame_score DESC」で人気曲を引くためのインデックス。
-- NULL (未計算) は末尾に追いやる。
create index if not exists idx_songs_fame_score
  on public.songs (fame_score desc nulls last);

-- バックフィル cron が「未計算行」を効率よく拾うため。
create index if not exists idx_songs_fame_pending
  on public.songs (fame_updated_at nulls first)
  where fame_score is null;

comment on column public.songs.fame_score is
  '日本語 Wikipedia 累計 pageviews の log10 値。NULL=未計算, 0=記事なし。';
comment on column public.songs.fame_article is
  'Wikipedia 記事タイトル (canonical)。NULL は記事が見つからなかった曲。';
comment on column public.songs.fame_views is
  '集計時点での 2015-07 以降の累計 pageviews。';
comment on column public.songs.fame_updated_at is
  '最終バックフィル日時。再計算判断 (例: 半年経過) に使う。';

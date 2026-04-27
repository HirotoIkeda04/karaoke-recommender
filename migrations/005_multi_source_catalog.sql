-- ============================================================================
-- マルチソース楽曲カタログ対応
-- ============================================================================
-- 背景:
--   Spotify API の quota 制約により、全曲を Spotify マッチ済みで揃える運用は
--   1 万曲規模では現実的でない。ジャケ画像/トラック ID は補助情報に降格し、
--   DAM ランキング等の他ソースから直接 (title, artist) ベースで投入する。
--
-- 変更点:
--   1. match_status: 楽曲が Spotify マッチング済か等を追跡
--   2. dam_request_no: DAM 楽曲 ID (例: "1268-85"). DAM 由来 dedup 用
--   3. last_spotify_attempt_at: 次回リトライ時の優先度判断用
--
-- 既存運用への影響:
--   - 既存 ~600 行は spotify_track_id が NOT NULL なので match_status='matched'
--     にバックフィル
--   - Spotify 列の unique 制約は維持(NULL は重複扱いされないので問題なし)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. match_status enum と列追加
-- ----------------------------------------------------------------------------

do $$ begin
  create type song_match_status as enum (
    'pending',           -- 未試行(新規取り込み直後)
    'matched',           -- Spotify track_id 取得済
    'unmatched',         -- 試行したが Spotify 上で見つからず(再試行可)
    'no_spotify',        -- Spotify 上に存在しないと確信(再試行不要)
    'external'           -- Spotify 連携不要のソース(将来的な分類用)
  );
exception
  when duplicate_object then null;
end $$;

alter table public.songs
  add column if not exists match_status song_match_status not null default 'pending',
  add column if not exists dam_request_no text,
  add column if not exists last_spotify_attempt_at timestamptz,
  add column if not exists spotify_attempt_count int not null default 0;


-- DAM 由来 dedup 用 unique。NULL は重複扱いされない(Postgres 標準)。
create unique index if not exists idx_songs_dam_request_no
  on public.songs (dam_request_no)
  where dam_request_no is not null;


-- ----------------------------------------------------------------------------
-- 2. 既存データのバックフィル
-- ----------------------------------------------------------------------------

-- spotify_track_id を持つ既存行は matched 扱い
update public.songs
set match_status = 'matched'
where spotify_track_id is not null
  and match_status = 'pending';


-- ----------------------------------------------------------------------------
-- 3. インデックス
-- ----------------------------------------------------------------------------

-- enrichment cron が「未試行 / 再試行優先」を効率よく引くため
create index if not exists idx_songs_match_status
  on public.songs (match_status, last_spotify_attempt_at nulls first)
  where match_status in ('pending', 'unmatched');


-- ----------------------------------------------------------------------------
-- 4. (title, artist) 複合検索用インデックス
-- ----------------------------------------------------------------------------
-- DAM seed 投入時の find-or-insert で使う。完全一致前提(正規化はアプリ層)。

create index if not exists idx_songs_title_artist
  on public.songs (title, artist);


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

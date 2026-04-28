-- ============================================================================
-- アーティストテーブル新設 + ジャンル分類
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法:
--   1. Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--   2. または `supabase db push` (Supabase CLI 使用時)
--
-- 設計:
--   1. artists テーブルを新設し、name_norm (NFKC + lowercase + 空白正規化) で
--      表記ゆれを吸収して unique 制約。既存 songs.artist (TEXT) からバックフィル。
--   2. ジャンルは TEXT[] + CHECK 制約で 13 種に enforce。
--   3. アーティスト単位でジャンルを持ち、曲単位で上書き可能。
--      検索時は COALESCE(NULLIF(songs.genres, '{}'), artists.genres)。
--
-- ジャンル一覧 (enum 値 / UI ラベル):
--   j_pop / J-POP            j_rock / 邦ロック
--   anison / アニソン         vocaloid_utaite / ボカロ・歌い手
--   idol_female / 女性アイドル  idol_male / 男性アイドル
--   rnb_soul / R&B・ソウル    hiphop / ヒップホップ
--   enka_kayo / 演歌・歌謡曲  western / 洋楽
--   kpop / K-POP             game_bgm / ゲーム・劇伴
--   other / その他
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 名寄せ正規化関数
-- ----------------------------------------------------------------------------
-- NFKC で全角→半角・互換文字を統一し、lower + trim + 連続空白を圧縮。
-- 例: "ＹＯＡＳＯＢＩ" / "yoasobi" / " YOASOBI " → "yoasobi"

create or replace function public.normalize_artist_name(name text) returns text as $$
  select lower(regexp_replace(trim(normalize(name, NFKC)), '\s+', ' ', 'g'))
$$ language sql immutable;


-- ----------------------------------------------------------------------------
-- 2. artists テーブル
-- ----------------------------------------------------------------------------

create table if not exists public.artists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                  -- 表示用の代表表記
  name_norm   text not null unique,           -- 名寄せキー (NFKC + lower + trim)
  genres      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint artists_genres_valid check (
    genres <@ array[
      'j_pop','j_rock','anison','vocaloid_utaite',
      'idol_female','idol_male','rnb_soul','hiphop',
      'enka_kayo','western','kpop','game_bgm','other'
    ]::text[]
  )
);

create index if not exists idx_artists_name on public.artists (name);
create index if not exists idx_artists_genres_gin on public.artists using gin (genres);


-- ----------------------------------------------------------------------------
-- 3. songs に artist_id と genres を追加
-- ----------------------------------------------------------------------------

alter table public.songs
  add column if not exists artist_id uuid references public.artists(id),
  add column if not exists genres    text[];   -- NULL=artist 継承 / 非NULL=上書き

alter table public.songs
  drop constraint if exists songs_genres_valid;

alter table public.songs
  add constraint songs_genres_valid check (
    genres is null or genres <@ array[
      'j_pop','j_rock','anison','vocaloid_utaite',
      'idol_female','idol_male','rnb_soul','hiphop',
      'enka_kayo','western','kpop','game_bgm','other'
    ]::text[]
  );


-- ----------------------------------------------------------------------------
-- 4. 既存データ移行
-- ----------------------------------------------------------------------------

-- 4-1. distinct artist を normalize でグルーピングして artists に投入。
--      代表表記は同じグループ内で出現回数が多い順、タイは ASC 順で先頭を採用。
insert into public.artists (name, name_norm)
select
  (array_agg(artist order by cnt desc, artist asc))[1] as name,
  name_norm
from (
  select
    artist,
    public.normalize_artist_name(artist) as name_norm,
    count(*) as cnt
  from public.songs
  where artist is not null and length(trim(artist)) > 0
  group by artist, public.normalize_artist_name(artist)
) t
group by name_norm
on conflict (name_norm) do nothing;

-- 4-2. songs.artist_id をバックフィル
update public.songs s
set artist_id = a.id
from public.artists a
where a.name_norm = public.normalize_artist_name(s.artist)
  and s.artist_id is null;


-- ----------------------------------------------------------------------------
-- 5. インデックス
-- ----------------------------------------------------------------------------

create index if not exists idx_songs_artist_id on public.songs (artist_id);


-- ----------------------------------------------------------------------------
-- 6. 検索用 VIEW: effective_genres を事前計算
-- ----------------------------------------------------------------------------
-- アプリ側の検索クエリは原則この VIEW を叩く。
--   - songs.genres が非空ならそれを採用 (曲単位の上書き)
--   - そうでなければ artists.genres を継承

create or replace view public.songs_with_genres as
select
  s.*,
  coalesce(nullif(s.genres, '{}'::text[]), a.genres) as effective_genres,
  a.name as artist_name_canonical
from public.songs s
left join public.artists a on s.artist_id = a.id;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================
-- 注意:
--   - songs.artist (TEXT 列) は当面残す。完全に artist_id 経由に切り替えた後で
--     別マイグレーションで drop する。
--   - artist_id は nullable のまま。バックフィル取り漏れ (NULL / 空文字) を許容。
--   - 同名異アーティスト (例: 同じ "FLOW") は手動で name_norm を分ける運用。
-- ============================================================================

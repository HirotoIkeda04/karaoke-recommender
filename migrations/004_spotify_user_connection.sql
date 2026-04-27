-- ============================================================================
-- Spotify ユーザー連携用のテーブル群
-- ============================================================================
-- ユーザーが OAuth 経由で連携した Spotify アカウントの token を保存し、
-- Spotify から取得した「聴いたことがある曲」を songs テーブルと照合して
-- 評価画面で「🎧 聴いた曲」として表示するための基盤。
--
-- セキュリティ:
--   - access_token / refresh_token はアプリ層で AES-256-GCM 暗号化したものを格納
--   - RLS で auth.uid() = user_id の自己レコードのみアクセス可
--   - 第三者へのデータ提供は行わない (プライバシーポリシー記載)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. user_spotify_connections: ユーザーごとの Spotify 接続情報
-- ----------------------------------------------------------------------------

create table if not exists public.user_spotify_connections (
  user_id              uuid primary key references auth.users(id) on delete cascade,

  -- Spotify 側のユーザー識別子(プロフィール表示用)
  spotify_user_id      text not null,
  spotify_display_name text,

  -- アプリ層で暗号化されたトークン (iv:authTag:ciphertext 形式の base64 文字列)
  access_token         text not null,
  refresh_token        text not null,

  -- 取得した scope の一覧
  scopes               text[] not null,

  -- access_token の有効期限 (refresh で再取得時に更新)
  expires_at           timestamptz not null,

  -- 接続日時(初回連携時刻)
  connected_at         timestamptz not null default now(),

  -- 直近の sync(楽曲取得)時刻
  last_synced_at       timestamptz,

  -- レコード更新時刻
  updated_at           timestamptz not null default now()
);

-- updated_at 自動更新
drop trigger if exists trg_user_spotify_connections_updated_at
  on public.user_spotify_connections;
create trigger trg_user_spotify_connections_updated_at
  before update on public.user_spotify_connections
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 2. user_known_songs: ユーザーが Spotify で聴いた曲のキャッシュ
-- ----------------------------------------------------------------------------

create table if not exists public.user_known_songs (
  user_id    uuid not null references auth.users(id) on delete cascade,
  song_id    uuid not null references public.songs(id) on delete cascade,

  -- どこから取得したかのソース種別
  --   top_short_term: 過去 4 週間のお気に入り (Spotify /v1/me/top/tracks)
  --   top_medium_term: 過去 6 ヶ月
  --   top_long_term: 全期間
  --   recently_played: 直近 50 曲の再生履歴
  --   saved: ❤️ で Saved した曲 (Liked Songs)
  source     text not null check (source in (
    'top_short_term',
    'top_medium_term',
    'top_long_term',
    'recently_played',
    'saved'
  )),

  -- TOP の場合の順位 (top_* のみ)
  rank       int,

  -- 直近で確認できた時刻
  last_seen  timestamptz not null default now(),

  primary key (user_id, song_id, source)
);

-- ユーザー単位のクエリ高速化
create index if not exists idx_user_known_songs_user
  on public.user_known_songs (user_id);

-- 楽曲単位の参照(複数ユーザー集計用、将来の機能向け)
create index if not exists idx_user_known_songs_song
  on public.user_known_songs (song_id);


-- ----------------------------------------------------------------------------
-- 3. RLS: 自己レコードのみアクセス可
-- ----------------------------------------------------------------------------

-- user_spotify_connections
alter table public.user_spotify_connections enable row level security;

drop policy if exists "Users can view own spotify connection"
  on public.user_spotify_connections;
create policy "Users can view own spotify connection"
  on public.user_spotify_connections for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own spotify connection"
  on public.user_spotify_connections;
create policy "Users can insert own spotify connection"
  on public.user_spotify_connections for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own spotify connection"
  on public.user_spotify_connections;
create policy "Users can update own spotify connection"
  on public.user_spotify_connections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own spotify connection"
  on public.user_spotify_connections;
create policy "Users can delete own spotify connection"
  on public.user_spotify_connections for delete
  using (auth.uid() = user_id);


-- user_known_songs
alter table public.user_known_songs enable row level security;

drop policy if exists "Users can view own known songs"
  on public.user_known_songs;
create policy "Users can view own known songs"
  on public.user_known_songs for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own known songs"
  on public.user_known_songs;
create policy "Users can insert own known songs"
  on public.user_known_songs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own known songs"
  on public.user_known_songs;
create policy "Users can update own known songs"
  on public.user_known_songs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own known songs"
  on public.user_known_songs;
create policy "Users can delete own known songs"
  on public.user_known_songs for delete
  using (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 4. 権限付与
-- ----------------------------------------------------------------------------

grant all on public.user_spotify_connections to authenticated;
grant all on public.user_known_songs         to authenticated;

-- service_role は migration 002 の default privileges で自動付与される

-- ============================================================================
-- カラオケ推薦アプリ フェーズ1 初期マイグレーション
-- ============================================================================
-- 実行先: Supabase (PostgreSQL 15+)
-- 実行方法:
--   1. Supabase ダッシュボード > SQL Editor に全文貼り付けて実行
--   2. または `supabase db push` (Supabase CLI 使用時)
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 拡張機能
-- ----------------------------------------------------------------------------

-- uuid_generate_v4 は Supabase で標準的に使うので有効化しておく
-- (gen_random_uuid は pgcrypto で標準提供)
create extension if not exists "pgcrypto";


-- ----------------------------------------------------------------------------
-- 2. ENUM 型定義
-- ----------------------------------------------------------------------------

-- 評価値: 苦手 / 普通 / 得意 / 練習中
do $$ begin
  create type rating_type as enum ('hard', 'medium', 'easy', 'practicing');
exception
  when duplicate_object then null;
end $$;


-- ----------------------------------------------------------------------------
-- 3. songs テーブル(楽曲マスタ)
-- ----------------------------------------------------------------------------

create table if not exists public.songs (
  id                  uuid primary key default gen_random_uuid(),

  -- 楽曲基本情報
  title               text not null,
  artist              text not null,
  release_year        int,

  -- 音域(MIDI note number で正規化、hiA = 69 基準)
  range_low_midi      int,  -- 地声最低音
  range_high_midi     int,  -- 地声最高音
  falsetto_max_midi   int,  -- 裏声最高音(nullable: 裏声未使用曲)

  -- Spotify 連携
  spotify_track_id    text unique,
  image_url_large     text,  -- 640x640
  image_url_medium    text,  -- 300x300
  image_url_small     text,  --  64x64

  -- 有名曲フラグ(カラ音で太字だった曲 = 代表曲)
  is_popular          boolean not null default false,

  -- メタデータ
  source_urls         text[] default '{}',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- 音域の妥当性(整合性制約)
  constraint song_range_valid
    check (
      range_low_midi is null
      or range_high_midi is null
      or range_low_midi <= range_high_midi
    ),
  constraint midi_range_reasonable
    check (
      (range_low_midi    is null or range_low_midi    between 0 and 127) and
      (range_high_midi   is null or range_high_midi   between 0 and 127) and
      (falsetto_max_midi is null or falsetto_max_midi between 0 and 127)
    )
);

-- 検索用インデックス
create index if not exists idx_songs_title
  on public.songs using gin (to_tsvector('simple', title));

create index if not exists idx_songs_artist
  on public.songs (artist);

create index if not exists idx_songs_range_high
  on public.songs (range_high_midi);

create index if not exists idx_songs_popular
  on public.songs (is_popular)
  where is_popular = true;

create index if not exists idx_songs_spotify_id
  on public.songs (spotify_track_id);

-- songs.updated_at 自動更新トリガ
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_songs_updated_at on public.songs;
create trigger trg_songs_updated_at
  before update on public.songs
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 4. evaluations テーブル(ユーザー評価)
-- ----------------------------------------------------------------------------

create table if not exists public.evaluations (
  user_id     uuid not null references auth.users(id) on delete cascade,
  song_id     uuid not null references public.songs(id) on delete cascade,

  rating      rating_type not null,
  memo        text,
  key_shift   int,         -- 将来用。キー調整値(半音単位、原曲=0)

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, song_id),

  constraint key_shift_reasonable
    check (key_shift is null or key_shift between -12 and 12)
);

-- 一覧フィルタ用インデックス
create index if not exists idx_evaluations_user_rating
  on public.evaluations (user_id, rating);

create index if not exists idx_evaluations_updated
  on public.evaluations (user_id, updated_at desc);

-- updated_at 自動更新
drop trigger if exists trg_evaluations_updated_at on public.evaluations;
create trigger trg_evaluations_updated_at
  before update on public.evaluations
  for each row execute function public.set_updated_at();


-- ----------------------------------------------------------------------------
-- 5. 音域推定ビュー(user_voice_estimate)
-- ----------------------------------------------------------------------------
-- 評価データからユーザーの音域を統計的に推定する。
-- API 層で評価数が少ない場合のフォールバックを実装すること。

create or replace view public.user_voice_estimate as
select
  e.user_id,

  -- 評価数(能力評価済みのもの)
  count(*) filter (where e.rating in ('easy','medium','hard')) as rated_count,
  count(*) filter (where e.rating = 'easy')                    as easy_count,

  -- 快適な上限(easy の最高音の75パーセンタイル)
  percentile_cont(0.75) within group (order by s.range_high_midi)
    filter (where e.rating = 'easy' and s.range_high_midi is not null)
    as comfortable_max_midi,

  -- 限界の上限(easy の最高音の最大値)
  max(s.range_high_midi) filter (where e.rating = 'easy')      as limit_max_midi,

  -- 快適な下限(easy の最低音の25パーセンタイル)
  percentile_cont(0.25) within group (order by s.range_low_midi)
    filter (where e.rating = 'easy' and s.range_low_midi is not null)
    as comfortable_min_midi,

  -- 限界の下限
  min(s.range_low_midi) filter (where e.rating = 'easy')       as limit_min_midi,

  -- 裏声の推定上限
  max(s.falsetto_max_midi) filter (where e.rating = 'easy')    as falsetto_max_midi
from public.evaluations e
join public.songs s on s.id = e.song_id
where e.rating != 'practicing'
group by e.user_id;

-- ビューは通常、所有者(postgres)権限で実行されるので、
-- RLSを迂回してしまう。security_invoker でユーザー権限で実行させる
alter view public.user_voice_estimate set (security_invoker = on);


-- ----------------------------------------------------------------------------
-- 6. Row Level Security (RLS)
-- ----------------------------------------------------------------------------

-- ---- songs: 全ユーザーが閲覧可能、書き込みは不可(seed投入は service_role で)
alter table public.songs enable row level security;

drop policy if exists "Anyone can view songs" on public.songs;
create policy "Anyone can view songs"
  on public.songs for select
  using (true);

-- ※ INSERT/UPDATE/DELETE のポリシーは意図的に作成しない
--   = 通常ユーザー(authenticated)は書き込み不可
--   = seed 投入は service_role key で実施(RLS バイパス)


-- ---- evaluations: ユーザーは自分のデータのみ操作可能
alter table public.evaluations enable row level security;

drop policy if exists "Users can view own evaluations" on public.evaluations;
create policy "Users can view own evaluations"
  on public.evaluations for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own evaluations" on public.evaluations;
create policy "Users can insert own evaluations"
  on public.evaluations for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own evaluations" on public.evaluations;
create policy "Users can update own evaluations"
  on public.evaluations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own evaluations" on public.evaluations;
create policy "Users can delete own evaluations"
  on public.evaluations for delete
  using (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 7. 権限付与
-- ----------------------------------------------------------------------------

-- authenticated ロール(ログインユーザー)
grant select on public.songs                 to authenticated;
grant all    on public.evaluations           to authenticated;
grant select on public.user_voice_estimate   to authenticated;

-- anon ロール(未ログイン。楽曲マスタ閲覧のみ許可)
grant select on public.songs                 to anon;


-- ----------------------------------------------------------------------------
-- 8. ヘルパ関数: 未評価曲を取得
-- ----------------------------------------------------------------------------
-- スワイプ画面で使用。ログインユーザーがまだ評価していない曲をランダムに返す。

create or replace function public.get_unrated_songs(
  p_limit           int     default 20,
  p_popular_only    boolean default false
)
returns setof public.songs
language sql
stable
security invoker
as $$
  select s.*
  from public.songs s
  where not exists (
    select 1
    from public.evaluations e
    where e.user_id = auth.uid()
      and e.song_id = s.id
  )
    and (p_popular_only = false or s.is_popular = true)
  order by random()
  limit p_limit;
$$;

grant execute on function public.get_unrated_songs to authenticated;


-- ----------------------------------------------------------------------------
-- 9. ヘルパ関数: ユーザーの評価統計
-- ----------------------------------------------------------------------------

create or replace function public.get_user_rating_stats()
returns table (
  rating rating_type,
  count  bigint
)
language sql
stable
security invoker
as $$
  select e.rating, count(*)::bigint
  from public.evaluations e
  where e.user_id = auth.uid()
  group by e.rating;
$$;

grant execute on function public.get_user_rating_stats to authenticated;


-- ============================================================================
-- マイグレーション完了
-- ============================================================================

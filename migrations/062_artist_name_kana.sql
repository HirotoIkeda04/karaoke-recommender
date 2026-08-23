-- ============================================================================
-- 062: アーティスト名の読み仮名 (name_kana) と、読みでの検索
-- ----------------------------------------------------------------------------
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 060 (normalize_search_key / *_search) 実行済み
--
-- 背景:
--   060 のカナ折り畳みで拾えるのは「元々カナ表記のアーティスト」だけだった。
--     すぴっつ   → スピッツ            ○ (060 で解決済み)
--     よねづ     → 米津玄師            × 漢字名なので読みが要る
--     せかいのおわり → SEKAI NO OWARI  × ラテン名なので読みが要る
--   上位 120 件のうち漢字名が 34 件・ラテン名が 54 件あり、ここが空白のままだと
--   ひらがな入力の体験は半分しか埋まらない。
--
-- データ源:
--   JOYSOUND のアーティストページ (scripts/fetch-joysound-kana.ts)。
--   カラオケ DB は五十音で引けるように読みを持っているので、この用途では
--   カバー率・精度ともに最良。「175R → イナゴライダー」「AAA → トリプルエー」
--   のような読みは他のソースでは当てられない。
--   ユーザー判断により Wikipedia / Wikidata は使わない (信頼性の観点)。
--   JOYSOUND に無いアーティストは name_kana を NULL のままにする。推測は入れない。
--
-- 設計:
--   - name_kana        : JOYSOUND 由来の表記をそのまま (カタカナ)。表示・検証用
--   - name_kana_search : normalize_search_key を通した検索キー (生成列)
--   読みが無い行は name_kana_search も NULL になり、検索条件に一切引っかからない。
--   つまり読みが未取得のアーティストは 060 までの挙動のまま。後退はしない。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 列 + trigram index
-- ----------------------------------------------------------------------------
alter table public.artists
  add column if not exists name_kana text;

alter table public.artists
  add column if not exists name_kana_search text
    generated always as (nullif(public.normalize_search_key(name_kana), '')) stored;

create index if not exists idx_artists_name_kana_search_trgm
  on public.artists using gin (name_kana_search gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- 2. artists_with_song_count に読みを追加
-- ----------------------------------------------------------------------------
-- 060 の定義に末尾 2 列を足すだけ (CREATE OR REPLACE VIEW は末尾追加のみ可)。
create or replace view public.artists_with_song_count as
select
  a.id,
  a.name,
  a.name_norm,
  a.genres,
  array_length(a.genres, 1) is not null as is_labeled,
  a.created_at,
  a.updated_at,
  coalesce(count(s.id), 0)::int as song_count,
  a.name_search,
  a.name_kana,
  a.name_kana_search
from public.artists a
left join public.songs s on s.artist_id = a.id
group by a.id;


-- ----------------------------------------------------------------------------
-- 3. search_songs_and_artists: 060 の再定義 (読みでのマッチを追加)
-- ----------------------------------------------------------------------------
-- 060 からの差分:
--   - artists: name_kana_search でも引く。完全一致/前方一致の判定にも含める
--   - songs  : 読みで一致したアーティストの曲も返す
--
-- 2 番目が無いと「よねづ」で検索したときにアーティスト行だけ出て曲が 0 件、
-- という中途半端な結果になる。songs.artist は非正規化テキストなので、
-- artist_id 経由でしか読みと繋げられない。
--
-- 引数・戻り値の shape・並び順のロジックは 060 と同一。
-- ----------------------------------------------------------------------------

create or replace function public.search_songs_and_artists(
  p_q              text,
  p_low_midi       int default null,
  p_high_midi      int default null,
  p_artist_limit   int default 8,
  p_song_limit     int default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_q_key      text;
  v_q_pattern  text;
  v_artists    jsonb;
  v_songs      jsonb;
begin
  -- 入力正規化: *_search 列と同じ NFKC + lower + 記号除去 + カナ折り畳み
  v_q_key := public.normalize_search_key(coalesce(p_q, ''));

  if length(v_q_key) = 0 then
    return jsonb_build_object('artists', '[]'::jsonb, 'songs', '[]'::jsonb);
  end if;

  v_q_pattern := '%' || v_q_key || '%';

  -- --------------------------------------------------------------------------
  -- artists: 表記 (name_search) と読み (name_kana_search) のどちらでも引く
  -- --------------------------------------------------------------------------
  with matched as (
    select
      a.id,
      a.name,
      a.genres,
      a.song_count,
      case
        when a.name_search = v_q_key or a.name_kana_search = v_q_key then 0
        when a.name_search like v_q_key || '%'
          or a.name_kana_search like v_q_key || '%' then 1
        else 2
      end as match_rank,
      greatest(
        similarity(a.name_search, v_q_key),
        similarity(coalesce(a.name_kana_search, ''), v_q_key)
      ) as sim
    from public.artists_with_song_count a
    where a.name_search like v_q_pattern
       or a.name_kana_search like v_q_pattern
    order by match_rank, sim desc, a.song_count desc nulls last
    limit greatest(p_artist_limit, 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'name', m.name,
      'genres', m.genres,
      'song_count', m.song_count,
      'image_url', (
        select coalesce(s2.image_url_small, s2.image_url_medium)
        from public.songs s2
        where s2.artist_id = m.id
          and (s2.image_url_small is not null or s2.image_url_medium is not null)
        order by s2.release_year desc nulls last
        limit 1
      )
    )
    order by m.match_rank, m.sim desc, m.song_count desc nulls last
  ), '[]'::jsonb)
  into v_artists
  from matched m;

  -- --------------------------------------------------------------------------
  -- songs: title / artist の表記に加えて、読みで一致したアーティストの曲も
  --   - 読みが完全一致したアーティストの曲は、artist 完全一致と同じランク 1
  --   - 部分一致どまりの読みはランク 2 (タイトル部分一致と同列)
  -- --------------------------------------------------------------------------
  with kana_hit as (
    select a.id, (a.name_kana_search = v_q_key) as is_exact
    from public.artists a
    where a.name_kana_search like v_q_pattern
  ),
  matched as (
    select
      s.id,
      s.title,
      s.artist,
      s.release_year,
      s.range_low_midi,
      s.range_high_midi,
      s.falsetto_max_midi,
      s.image_url_small,
      s.image_url_medium,
      s.fame_score,
      case
        when s.title_search = v_q_key then 0
        when s.title_search like v_q_key || '%' then 1
        when s.artist_search = v_q_key then 1
        when exists (
          select 1 from kana_hit k where k.id = s.artist_id and k.is_exact
        ) then 1
        else 2
      end as match_rank
    from public.songs s
    where (
        s.title_search like v_q_pattern
        or s.artist_search like v_q_pattern
        or exists (select 1 from kana_hit k where k.id = s.artist_id)
      )
      and (p_low_midi is null or s.range_low_midi >= p_low_midi)
      and (p_high_midi is null or s.range_high_midi <= p_high_midi)
    order by
      match_rank,
      coalesce(s.fame_score, 0) desc,
      s.release_year desc nulls last,
      s.title
    limit greatest(p_song_limit, 0)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'title', m.title,
      'artist', m.artist,
      'release_year', m.release_year,
      'range_low_midi', m.range_low_midi,
      'range_high_midi', m.range_high_midi,
      'falsetto_max_midi', m.falsetto_max_midi,
      'image_url_small', m.image_url_small,
      'image_url_medium', m.image_url_medium,
      'fame_score', m.fame_score
    )
    order by
      m.match_rank,
      coalesce(m.fame_score, 0) desc,
      m.release_year desc nulls last,
      m.title
  ), '[]'::jsonb)
  into v_songs
  from matched m;

  return jsonb_build_object('artists', v_artists, 'songs', v_songs);
end;
$$;

grant execute on function public.search_songs_and_artists(text, int, int, int, int)
  to authenticated, anon;

notify pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

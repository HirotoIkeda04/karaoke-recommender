-- ============================================================================
-- 060: 検索キーのカナ折り畳み正規化
-- ----------------------------------------------------------------------------
-- 実行先: Supabase (PostgreSQL 15+)
-- 前提: 011 / 012 / 032 / 056 実行済み
--
-- 背景:
--   検索は artists.name_norm (NFKC + lower + 記号除去) だけをキーにしていた。
--   NFKC はカタカナとひらがなを畳まないため、
--     - 「ぽるのぐらふぃてぃ」→ ポルノグラフィティ    (0 件)
--     - 「すぴっつ」          → スピッツ              (0 件)
--     - 「さざんおーるすたーず」→ サザンオールスターズ (0 件)
--   のように、IME で変換確定する前のひらがな入力が一切ヒットしなかった。
--   実データ (artists 1874 / songs 5938) での実測では、上記 3 例だけで
--   曲側 0 → 45 / 43 / 32 件の取りこぼしが発生している。
--
-- 方針:
--   名寄せキーである artists.name_norm (UNIQUE) には手を触れず、
--   「検索専用の正規化キー」を別に持つ。
--     - name_norm  : 同一アーティストの表記ゆれを 1 行に寄せるための厳格キー
--     - *_search   : 検索マッチ専用の緩いキー (カナ折り畳み + 長音除去)
--   これにより UNIQUE 衝突のリスクがなく、TS 側で name_norm を再現している
--   既存スクリプト (backfill-artist-id.ts など) にも影響しない。
--
-- 折り畳みの内容 (normalize_artist_name に追加する分):
--   1. カタカナ → ひらがな   (ァ-ヶ → ぁ-ゖ)
--   2. 長音符・波ダッシュ除去 (ー / 〜 / ~)
--   3. 小書きカナ → 大書き   (ぁぃぅぇぉっゃゅょゎゕゖ → あいうえおつやゆよわかけ)
--   濁点・半濁点は畳まない (バンド/ハンド が同一になり誤ヒットが増えるため)。
--
-- 検索クエリ側と被検索側の両方に同じキーを使うので、
--   カタカナ入力が従来どおりヒットしなくなるような後退は起きない。
--
-- 適用コスト: 生成列の追加でテーブル書き換えが入るが、対象は
--   artists 1874 行 / songs 5938 行 と小さい。
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. 検索用正規化関数
-- ----------------------------------------------------------------------------
-- 記号・空白の除去は normalize_artist_name (033) をそのまま再利用し、
-- 「カナ折り畳み」だけを上に重ねる。
create or replace function public.normalize_search_key(input text)
returns text
language sql
immutable
as $$
  select translate(
    translate(
      regexp_replace(
        public.normalize_artist_name(coalesce(input, '')),
        '[ー〜~]+',
        '',
        'g'
      ),
      'ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ',
      'ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをんゔゕゖ'
    ),
    'ぁぃぅぇぉっゃゅょゎゕゖ',
    'あいうえおつやゆよわかけ'
  )
$$;


-- ----------------------------------------------------------------------------
-- 2. 検索キー列 + trigram index
-- ----------------------------------------------------------------------------
-- 生成列にしておけば、以後の INSERT/UPDATE 経路 (スクリプト・管理画面・
-- Server Action) すべてで自動的に同期される。
alter table public.artists
  add column if not exists name_search text
    generated always as (public.normalize_search_key(name)) stored;

alter table public.songs
  add column if not exists title_search text
    generated always as (public.normalize_search_key(title)) stored,
  add column if not exists artist_search text
    generated always as (public.normalize_search_key(artist)) stored;

create index if not exists idx_artists_name_search_trgm
  on public.artists using gin (name_search gin_trgm_ops);

create index if not exists idx_songs_title_search_trgm
  on public.songs using gin (title_search gin_trgm_ops);

create index if not exists idx_songs_artist_search_trgm
  on public.songs using gin (artist_search gin_trgm_ops);


-- ----------------------------------------------------------------------------
-- 3. artists_with_song_count に name_search を追加
-- ----------------------------------------------------------------------------
-- 012 の定義に末尾 1 列を足すだけ (CREATE OR REPLACE VIEW は末尾追加のみ可)。
-- 既存の GRANT は replace で維持される。
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
  a.name_search
from public.artists a
left join public.songs s on s.artist_id = a.id
group by a.id;


-- ----------------------------------------------------------------------------
-- 4. search_songs_and_artists: 056 の再定義 (マッチキーのみ変更)
-- ----------------------------------------------------------------------------
-- 056 からの差分は「何と突き合わせるか」だけ:
--   - クエリ正規化      normalize_artist_name → normalize_search_key
--   - artists のマッチ  name_norm  → name_search
--   - songs のマッチ    title / artist の生 ILIKE → title_search / artist_search
--
-- 引数・戻り値の shape・並び順のロジックは 056 と同一。
-- 引数名も同一なので DROP せず CREATE OR REPLACE で置き換えられる。
--
-- なお songs 側は従来「正規化済みクエリ」を「生の title」に ILIKE していたため、
--   "bump of chicken" → "bumpofchicken" が生の artist に一致せず 0 件、
-- といった取りこぼしがあった。両側を同じキーに揃えることでこれも解消する。
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
  -- artists: name_search の部分一致 + 完全一致/前方一致を優先
  -- --------------------------------------------------------------------------
  with matched as (
    select
      a.id,
      a.name,
      a.genres,
      a.song_count,
      case
        when a.name_search = v_q_key then 0
        when a.name_search like v_q_key || '%' then 1
        else 2
      end as match_rank,
      similarity(a.name_search, v_q_key) as sim
    from public.artists_with_song_count a
    where a.name_search like v_q_pattern
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
  -- songs: title_search / artist_search の部分一致 + 音域フィルタ
  --   - title 完全一致 → 前方一致 → 部分一致 の順でランク付け
  --   - 同ランク内では fame_score 降順 → release_year 降順
  -- --------------------------------------------------------------------------
  with matched as (
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
        else 2
      end as match_rank
    from public.songs s
    where (s.title_search like v_q_pattern or s.artist_search like v_q_pattern)
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

grant execute on function public.normalize_search_key(text)
  to authenticated, anon;

notify pgrst, 'reload schema';

-- ============================================================================
-- マイグレーション完了
-- ============================================================================

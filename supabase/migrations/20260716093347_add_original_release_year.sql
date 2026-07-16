set lock_timeout = '5s';

alter table public.songs
  add column original_release_year smallint,
  add column original_release_year_source text,
  add column original_release_year_source_id text,
  add column original_release_year_updated_at timestamptz;

alter table public.songs
  add constraint songs_original_release_year_valid
  check (original_release_year between 1900 and 2100);

comment on column public.songs.release_year is
  'Release year reported by the current metadata source; this may be an album reissue or redistribution year.';

comment on column public.songs.original_release_year is
  'Earliest confidently matched release year for the song. Kept separate from release_year so reissues do not destroy source metadata.';

comment on column public.songs.original_release_year_source is
  'Provider used to establish original_release_year, for example musicbrainz.';

comment on column public.songs.original_release_year_source_id is
  'Stable provider identifier supporting original_release_year provenance.';

comment on column public.songs.original_release_year_updated_at is
  'Time original_release_year and its provenance were last established.';

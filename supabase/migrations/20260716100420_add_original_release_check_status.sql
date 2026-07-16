set lock_timeout = '5s';

alter table public.songs
  add column original_release_year_check_status text,
  add column original_release_year_checked_at timestamptz,
  add column original_release_year_check_details jsonb;

alter table public.songs
  add constraint songs_original_release_year_check_status_valid
  check (
    original_release_year_check_status is null
    or original_release_year_check_status in (
      'matched',
      'conflict',
      'not_found',
      'error'
    )
  );

update public.songs
set
  original_release_year_check_status = 'matched',
  original_release_year_checked_at = original_release_year_updated_at
where original_release_year is not null;

comment on column public.songs.original_release_year_check_status is
  'Last automated original release lookup result: matched, conflict, not_found, or error.';

comment on column public.songs.original_release_year_checked_at is
  'Time the external original release lookup last completed.';

comment on column public.songs.original_release_year_check_details is
  'Non-sensitive structured reason or provider-year comparison for the last lookup.';

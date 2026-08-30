-- Provenance columns on the EXISTING Hostiggo tables (reconciled against the
-- live hostiggo_testing_schema on 2026-08-30).
--
-- Safe to re-run. Kept separate from 001 so a mismatch here can't roll back the
-- import tables.

set search_path to hostiggo_testing_schema, public;

alter table listings
  add column if not exists source                   text not null default 'native',
  add column if not exists import_id                bigint,
  add column if not exists external_url             text,
  add column if not exists external_listing_id      text,
  add column if not exists import_confirmed_by_host boolean not null default false,
  add column if not exists min_nights               integer,
  add column if not exists max_nights               integer;

alter table listing_media
  add column if not exists source     text not null default 'upload',
  add column if not exists source_url text,
  add column if not exists import_id  bigint;

-- real listings.listing_id is integer; align the import table's FK column
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'hostiggo_testing_schema' and table_name = 'listing_imports'
      and column_name = 'listing_id' and data_type = 'bigint'
  ) then
    alter table listing_imports alter column listing_id type integer using listing_id::integer;
  end if;
end $$;

-- link columns -> listing_imports / listings (NOT VALID = no full-table scan)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_import_fk') then
    alter table listings add constraint listings_import_fk
      foreign key (import_id) references listing_imports (import_id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listing_media_import_fk') then
    alter table listing_media add constraint listing_media_import_fk
      foreign key (import_id) references listing_imports (import_id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'listing_imports_listing_fk') then
    alter table listing_imports add constraint listing_imports_listing_fk
      foreign key (listing_id) references listings (listing_id) on delete set null not valid;
  end if;
end $$;

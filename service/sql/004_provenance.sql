-- Provenance columns on the EXISTING Hostiggo tables + the listing_imports FK.
-- Kept separate from 001 so a table/column-name mismatch here (reconcile with
-- app/schema_map.py) can't roll back the new import tables.
--
-- If your existing tables are NOT in hostiggo_testing_schema, change the line
-- below. If a table is named differently, edit it here and in app/schema_map.py.

set search_path to hostiggo_testing_schema, public;

alter table listings
  add column if not exists source                   text not null default 'native',
  add column if not exists import_id                bigint references listing_imports (import_id)
                                                      on delete set null,
  add column if not exists external_url             text,
  add column if not exists external_listing_id      text,
  add column if not exists import_confirmed_by_host boolean not null default false,
  add column if not exists min_nights               int,
  add column if not exists max_nights               int,
  add column if not exists cancellation_policy      text;

alter table listing_media
  add column if not exists source     text not null default 'upload',
  add column if not exists source_url text,
  add column if not exists import_id  bigint references listing_imports (import_id)
                                        on delete set null;

-- link back from the import to the created listing (NOT VALID = no full-table scan)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listing_imports_listing_fk'
  ) then
    alter table listing_imports
      add constraint listing_imports_listing_fk
      foreign key (listing_id) references listings (id) on delete set null not valid;
  end if;
end $$;

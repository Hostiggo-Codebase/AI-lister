-- Hostiggo OTA Listing Import — new tables & columns
-- Target schema: hostiggo_testing_schema  (change the SET below if different)

-- If your existing listing tables live in a different schema, change both
-- occurrences below AND set DB_SCHEMA / IMPORT_SCHEMA in service/.env to match.
create schema if not exists hostiggo_testing_schema;
set search_path to hostiggo_testing_schema, public;

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------- --
-- shared updated_at trigger
-- --------------------------------------------------------------------------- --
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- --------------------------------------------------------------------------- --
-- import_batches — one row per "import all my listings" run
-- --------------------------------------------------------------------------- --
create table if not exists import_batches (
  batch_id    bigint generated always as identity primary key,
  source_url  text not null,
  provider    text not null,
  host_name   text,
  host_uuid   uuid,
  created_at  timestamptz not null default now()
);

-- --------------------------------------------------------------------------- --
-- listing_imports — the heart of the feature
-- --------------------------------------------------------------------------- --
create table if not exists listing_imports (
  import_id                bigint generated always as identity primary key,
  batch_id                 bigint references import_batches (batch_id) on delete set null,
  listing_id               bigint,                       -- set after publish
  host_uuid                uuid,
  created_by               uuid,
  source                   text not null default 'airbnb_import',
  provider                 text not null default 'airbnb'
                             check (provider in
                             ('airbnb','booking','agoda','makemytrip','goibibo','unknown')),
  source_url               text not null,
  external_listing_id      text,
  status                   text not null default 'pending'
                             check (status in
                             ('pending','fetching','parsed','needs_review','published','failed')),
  stage                    text not null default 'queued',
  tier_used                smallint,
  options                  jsonb not null default '{}'::jsonb,
  raw_payload              jsonb,                        -- untouched scrape (audit)
  normalized_payload       jsonb,                        -- mapped Hostiggo draft
  field_coverage           jsonb,                        -- per-field auto/partial/manual/missing
  recommendations          jsonb not null default '[]'::jsonb,
  fx                       jsonb,
  ical                     jsonb,
  source_currency          text,
  fx_rate                  numeric,
  source_photo_urls        jsonb not null default '[]'::jsonb,
  mirrored_photos          jsonb not null default '[]'::jsonb,
  logs                     jsonb not null default '[]'::jsonb,
  host_confirmed_ownership boolean not null default false,
  error_message            text,
  last_synced_at           timestamptz,                  -- future re-sync
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists listing_imports_status_created_idx
  on listing_imports (status, created_at);
create index if not exists listing_imports_batch_idx on listing_imports (batch_id);
create index if not exists listing_imports_host_idx on listing_imports (host_uuid, created_at desc);
create unique index if not exists listing_imports_dedupe_idx
  on listing_imports (provider, external_listing_id)
  where external_listing_id is not null and status <> 'failed';

drop trigger if exists trg_listing_imports_updated on listing_imports;
create trigger trg_listing_imports_updated before update on listing_imports
  for each row execute function set_updated_at();

-- --------------------------------------------------------------------------- --
-- external_taxonomy_map — Airbnb/OTA vocabulary -> Hostiggo ids
-- --------------------------------------------------------------------------- --
create table if not exists external_taxonomy_map (
  id             bigint generated always as identity primary key,
  source         text not null,                          -- 'airbnb' | 'booking' | ...
  entity_type    text not null check (entity_type in ('amenity','property_type','stay_type')),
  external_value text not null,                           -- e.g. 'wifi', 'Entire villa'
  internal_id    bigint,                                  -- amenity_id / property_types.type_id / ...
  internal_slug  text,                                    -- convenience: our enum slug
  created_at     timestamptz not null default now(),
  unique (source, entity_type, external_value)
);

-- --------------------------------------------------------------------------- --
-- listing_ical_feeds — per-listing availability feed
-- --------------------------------------------------------------------------- --
create table if not exists listing_ical_feeds (
  id             bigint generated always as identity primary key,
  listing_id     bigint,
  import_id      bigint references listing_imports (import_id) on delete set null,
  feed_url       text not null,
  calendar_name  text,
  last_pulled_at timestamptz,
  last_status    text,
  blocked_dates  jsonb not null default '[]'::jsonb,
  events         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_listing_ical_feeds_updated on listing_ical_feeds;
create trigger trg_listing_ical_feeds_updated before update on listing_ical_feeds
  for each row execute function set_updated_at();

-- NOTE: the provenance columns on the EXISTING tables (listings, listing_media)
-- and the FK from listing_imports -> listings live in 004_provenance.sql, so a
-- name mismatch there can't roll back the new tables above.

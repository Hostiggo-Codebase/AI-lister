-- Hostiggo OTA Listing Importer — schema, storage, RLS
-- Apply with: supabase db push   (or paste into the SQL editor)

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- import_jobs — one row per paste-a-URL import attempt
-- ---------------------------------------------------------------------------
create table if not exists public.import_jobs (
  id                  uuid primary key default gen_random_uuid(),
  host_id             uuid references auth.users (id) on delete set null,
  source_url          text not null,
  provider            text not null check (provider in
                        ('airbnb','booking','agoda','makemytrip','goibibo','unknown')),
  consent             boolean not null default false,
  status              text not null default 'queued' check (status in
                        ('queued','running','succeeded','failed','committed')),
  stage               text not null default 'queued',
  options             jsonb not null default '{}'::jsonb,
  tier_used           smallint check (tier_used in (1,2)),
  raw_html_bytes      integer,
  truncated           boolean,
  truncation_reasons  jsonb not null default '[]'::jsonb,
  llm_model           text,
  raw_extraction      jsonb,
  validated_draft     jsonb,
  validation_report   jsonb not null default '[]'::jsonb,
  photos              jsonb not null default '[]'::jsonb,
  logs                jsonb not null default '[]'::jsonb,
  error               text,
  listing_id          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists import_jobs_status_created_idx
  on public.import_jobs (status, created_at);
create index if not exists import_jobs_host_idx
  on public.import_jobs (host_id, created_at desc);

drop trigger if exists trg_import_jobs_updated on public.import_jobs;
create trigger trg_import_jobs_updated before update on public.import_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- import_photos — mirrored copies of the OTA photos for a job
-- (denormalised copy also kept in import_jobs.photos for fast polling)
-- ---------------------------------------------------------------------------
create table if not exists public.import_photos (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references public.import_jobs (id) on delete cascade,
  idx           integer not null,
  original_url  text not null,
  storage_path  text,
  public_url    text,
  content_type  text,
  bytes         integer,
  status        text not null default 'pending' check (status in
                  ('pending','mirrored','failed')),
  error         text,
  caption       text,
  created_at    timestamptz not null default now(),
  unique (job_id, idx)
);

-- ---------------------------------------------------------------------------
-- listings — the real Hostiggo listing (minimal columns for the importer)
-- ---------------------------------------------------------------------------
create table if not exists public.listings (
  id                  uuid primary key default gen_random_uuid(),
  host_id             uuid references auth.users (id) on delete set null,
  title               text not null,
  summary             text,
  description         text not null default '',
  property_type       text not null default 'homestay',
  room_type           text not null default 'entire_place'
                        check (room_type in ('entire_place','private_room','shared_room')),
  address_line        text,
  city                text,
  state               text,
  country             text,
  pincode             text,
  lat                 double precision,
  lng                 double precision,
  max_guests          integer not null default 2,
  bedrooms            integer,
  beds                integer,
  bathrooms           numeric(4,1),
  base_price          numeric(12,2),
  currency            text not null default 'INR',
  cleaning_fee        numeric(12,2),
  amenities           text[] not null default '{}',
  house_rules         text[] not null default '{}',
  cancellation_policy text not null default 'unknown',
  min_nights          integer,
  max_nights          integer,
  check_in_time       text,
  check_out_time      text,
  status              text not null default 'draft'
                        check (status in ('draft','published','archived')),
  imported_from_job_id uuid references public.import_jobs (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_listings_updated on public.listings;
create trigger trg_listings_updated before update on public.listings
  for each row execute function public.set_updated_at();

create table if not exists public.listing_photos (
  id           uuid primary key default gen_random_uuid(),
  listing_id   uuid not null references public.listings (id) on delete cascade,
  storage_path text,
  public_url   text not null,
  sort_order   integer not null default 0,
  is_cover     boolean not null default false,
  caption      text,
  created_at   timestamptz not null default now()
);

alter table public.import_jobs   add constraint import_jobs_listing_fk
  foreign key (listing_id) references public.listings (id) on delete set null
  not valid;

-- ---------------------------------------------------------------------------
-- Storage bucket for mirrored photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('listing-imports', 'listing-imports', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row Level Security
--   * service_role (used by the Next.js API routes) bypasses RLS entirely.
--   * hosts may read/write only their own rows.
-- ---------------------------------------------------------------------------
alter table public.import_jobs    enable row level security;
alter table public.import_photos  enable row level security;
alter table public.listings       enable row level security;
alter table public.listing_photos enable row level security;

create policy "host reads own jobs" on public.import_jobs
  for select using (auth.uid() = host_id);
create policy "host inserts own jobs" on public.import_jobs
  for insert with check (auth.uid() = host_id);

create policy "host reads own job photos" on public.import_photos
  for select using (exists (
    select 1 from public.import_jobs j
    where j.id = import_photos.job_id and j.host_id = auth.uid()));

create policy "host reads own listings" on public.listings
  for select using (auth.uid() = host_id);
create policy "host writes own listings" on public.listings
  for all using (auth.uid() = host_id) with check (auth.uid() = host_id);

create policy "host reads own listing photos" on public.listing_photos
  for select using (exists (
    select 1 from public.listings l
    where l.id = listing_photos.listing_id and l.host_id = auth.uid()));

-- Storage: public read of the bucket, writes only via service_role.
create policy "public read listing-imports" on storage.objects
  for select using (bucket_id = 'listing-imports');

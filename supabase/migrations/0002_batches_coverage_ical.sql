-- Multi-listing batches, FX / coverage / recommendations, and iCal feeds.

-- ---------------------------------------------------------------------------
-- import_jobs: new columns
-- ---------------------------------------------------------------------------
alter table public.import_jobs
  add column if not exists batch_id            uuid,
  add column if not exists external_listing_id text,
  add column if not exists fx                  jsonb,
  add column if not exists coverage            jsonb,
  add column if not exists recommendations     jsonb not null default '[]'::jsonb,
  add column if not exists ical                jsonb;

-- ---------------------------------------------------------------------------
-- import_batches: one row per "import all my listings" run
-- ---------------------------------------------------------------------------
create table if not exists public.import_batches (
  id          uuid primary key default gen_random_uuid(),
  source_url  text not null,
  provider    text not null,
  host_name   text,
  job_ids     jsonb not null default '[]'::jsonb,
  host_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.import_jobs
  add constraint import_jobs_batch_fk
  foreign key (batch_id) references public.import_batches (id) on delete set null
  not valid;

-- ---------------------------------------------------------------------------
-- listing_ical_feeds: per-listing availability feed (Airbnb/Booking/Vrbo export)
-- ---------------------------------------------------------------------------
create table if not exists public.listing_ical_feeds (
  id             uuid primary key default gen_random_uuid(),
  listing_id     uuid references public.listings (id) on delete cascade,
  import_job_id  uuid references public.import_jobs (id) on delete set null,
  feed_url       text not null,
  calendar_name  text,
  last_pulled_at timestamptz,
  last_status    text,
  blocked_dates  jsonb not null default '[]'::jsonb,
  events         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_ical_feeds_updated on public.listing_ical_feeds;
create trigger trg_ical_feeds_updated before update on public.listing_ical_feeds
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- listings: provenance + phase-2 columns from the brainstorm doc
-- ---------------------------------------------------------------------------
alter table public.listings
  add column if not exists source              text not null default 'native',
  add column if not exists import_id           uuid references public.import_jobs (id) on delete set null,
  add column if not exists external_url        text,
  add column if not exists external_listing_id text,
  add column if not exists import_confirmed_by_host boolean not null default false;

alter table public.import_batches enable row level security;
alter table public.listing_ical_feeds enable row level security;

create policy "host reads own batches" on public.import_batches
  for select using (auth.uid() = host_id);
create policy "host reads own ical feeds" on public.listing_ical_feeds
  for select using (exists (
    select 1 from public.listings l
    where l.id = listing_ical_feeds.listing_id and l.host_id = auth.uid()));
